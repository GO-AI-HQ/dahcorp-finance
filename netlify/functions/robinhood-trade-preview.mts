import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { databaseAvailable, recordAudit, saveOrderPreviews } from '../lib/store.mts';
import { ROBINHOOD_EXECUTION_SYMBOL, ROBINHOOD_MAX_EXECUTION_SYMBOLS, type RobinhoodAdapter } from '../../src/brokers/robinhood/adapter.js';
import { validateRobinhoodExecution } from '../../src/risk/execution.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';

type RequestedSide = 'buy' | 'sell';
type RequestedSizing = 'quantity' | 'notional';

interface RobinhoodPreviewBody {
  accountId?: unknown;
  symbol?: unknown;
  side?: unknown;
  quantity?: unknown;
  notional?: unknown;
  rationale?: unknown;
  recommendationId?: unknown;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sixDecimals(value: number): number {
  return Math.floor(value * 1_000_000 + 1e-9) / 1_000_000;
}

/**
 * POST /.netlify/functions/robinhood-trade-preview
 *
 * Generalized human-confirmed Robinhood preview surface.
 *
 * Accepted shapes:
 *   { accountId, symbol, side: 'buy'|'sell', quantity }
 *   { accountId, symbol, side: 'buy'|'sell', notional }
 *
 * Dollar sizing is converted against a fresh Robinhood quote for deterministic
 * validation. For BUYs the adapter will preserve the exact dollar amount when
 * Robinhood's current MCP schema exposes a notional/dollar field; otherwise the
 * broker review uses the computed fractional share quantity. SELLs are always
 * bounded by the live confirmed position.
 */
export default withErrorHandling('robinhood-trade-preview', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Live trading is unavailable in public demo mode.');
  if (!databaseAvailable()) return fail(503, 'DATABASE_REQUIRED', 'Netlify Database is required for single-use live trade previews.');

  const body = await readJsonBody<RobinhoodPreviewBody>(req);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  const symbol = typeof body?.symbol === 'string' && body.symbol.trim() ? body.symbol.trim().toUpperCase() : ROBINHOOD_EXECUTION_SYMBOL;
  const side: RequestedSide = body?.side === 'sell' ? 'sell' : 'buy';
  const rawQuantity = finitePositive(body?.quantity);
  const rawNotional = finitePositive(body?.notional);
  const rationale = typeof body?.rationale === 'string' && body.rationale.trim()
    ? body.rationale.trim().slice(0, 500)
    : `Human-initiated ${side.toUpperCase()} ${symbol} request from the approved DAHCorp Agentic strategy universe.`;
  const recommendationId = typeof body?.recommendationId === 'number' && Number.isInteger(body.recommendationId) && body.recommendationId > 0
    ? body.recommendationId
    : null;

  if (!accountId || !symbol) return fail(400, 'INVALID_AGENTIC_ORDER', 'Choose the Robinhood Agentic account and an approved strategy symbol.');
  if ((rawQuantity == null && rawNotional == null) || (rawQuantity != null && rawNotional != null)) {
    return fail(400, 'AMBIGUOUS_ORDER_SIZE', 'Provide exactly one order size: either a positive share quantity or a positive dollar amount.');
  }

  const ctx = await buildServerContext();
  const configuredAllowlist = ctx.config.agenticGrowthAllowlist.map((item) => item.toUpperCase());
  if (!configuredAllowlist.includes(symbol) || !ROBINHOOD_MAX_EXECUTION_SYMBOLS.includes(symbol as (typeof ROBINHOOD_MAX_EXECUTION_SYMBOLS)[number])) {
    return fail(400, 'SYMBOL_NOT_ALLOWLISTED', `${symbol} is not in the approved Robinhood Agentic strategy universe.`);
  }
  if (ctx.config.agenticExecutionMode === 'shadow') {
    return fail(403, 'AGENTIC_SHADOW_MODE', 'Robinhood is in Shadow Mode. The engine may record what it would do, but no live preview may be created.');
  }

  const adapter = ctx.adapters.find((item) => item.id === 'robinhood') as RobinhoodAdapter | undefined;
  if (!adapter || !adapter.isConfigured()) return fail(503, 'ROBINHOOD_NOT_CONFIGURED', 'Robinhood Trading MCP is not connected.');
  if (!adapter.capabilities.includes('place_order')) return fail(403, 'ROBINHOOD_EXECUTION_DISABLED', 'Robinhood is connected read-only. Enable the guarded execution flag only after Shadow Mode has been reviewed.');

  const [accountData, quote] = await Promise.all([
    adapter.getAccountData(),
    adapter.getQuote(symbol),
  ]);
  const account = accountData.accounts.find((item) => item.id === accountId && item.broker === 'robinhood');
  if (!account || !account.tradeEligible) return fail(400, 'ROBINHOOD_AGENTIC_ACCOUNT_REQUIRED', 'Robinhood permits MCP order placement only in the Agentic account.');

  const sizing: RequestedSizing = rawNotional != null ? 'notional' : 'quantity';
  const requestedNotional = rawNotional;
  const quantity = rawQuantity ?? sixDecimals(rawNotional! / quote.price);
  if (!Number.isFinite(quantity) || quantity <= 0) return fail(400, 'ORDER_TOO_SMALL', 'The requested dollar amount is too small to produce a valid fractional share quantity at the current price.');

  const fractional = Math.abs(quantity - Math.round(quantity)) > 1e-9;
  const fractionalTradable = fractional ? await adapter.getFractionalTradability(symbol) : null;
  const holding = accountData.holdings.find((item) => item.accountId === account.id && item.symbol.toUpperCase() === symbol);
  const heldQuantity = holding?.shares ?? 0;

  const gate = validateRobinhoodExecution({
    symbol,
    side,
    orderType: 'market',
    quantity,
    price: quote.price,
    brokerCash: account.cash,
    brokerCashFloor: ctx.config.brokerCashFloor,
    maxOrderNotional: ctx.config.maxOrderNotional,
    killSwitch: ctx.config.killSwitch,
    executionEnabled: true,
    allowlist: configuredAllowlist,
    heldQuantity,
    fractionalTradable,
  });

  if (!gate.approved) {
    await recordAudit({
      category: 'risk',
      action: 'agentic_live_preview_blocked',
      severity: 'warning',
      message: `A ${side.toUpperCase()} ${symbol} live-trade preview was blocked by the deterministic Robinhood execution gate.`,
      detail: {
        accountId,
        symbol,
        side,
        sizing,
        requestedNotional,
        quantity,
        findingCodes: gate.findings.map((finding) => finding.code),
      },
    });
    return json({
      approved: false,
      previewId: null,
      symbol,
      side,
      sizing,
      requestedNotional,
      account: { id: account.id, name: account.name, cash: account.cash },
      quote,
      quantity,
      heldQuantity,
      estimatedTotal: gate.notional,
      fractionalTradable,
      findings: gate.findings,
      expiresInSeconds: 0,
      confirmationText: null,
    });
  }

  const instrument = getInstrumentOrFallback(symbol);
  const order: ProposedOrder = {
    id: `robinhood-preview-${Date.now()}`,
    accountId: account.id,
    broker: 'robinhood',
    symbol,
    side,
    quantity,
    notional: side === 'buy' && requestedNotional != null ? requestedNotional : undefined,
    orderType: 'market',
    rationale,
    origin: recommendationId ? 'agent' : 'manual',
    fundingSource: side === 'buy' ? 'broker_cash' : undefined,
    sleeve: instrument.sleeve,
  };

  const brokerPreview = await adapter.previewOrder(order);
  if (!brokerPreview.accepted) return fail(409, 'ROBINHOOD_PREVIEW_REJECTED', 'Robinhood did not accept the broker-side order review.');

  const ids = await saveOrderPreviews([{
    recommendationId,
    accountExternalId: account.id,
    broker: 'robinhood',
    symbol,
    side,
    notional: requestedNotional ?? gate.notional,
    quantity,
    orderType: 'market',
    limitPrice: null,
    origin: order.origin,
    sleeve: instrument.sleeve,
    rationale: order.rationale,
    approvedByRisk: true,
    allowedNotional: gate.notional,
    findings: gate.findings,
    impact: {
      quoteAsOf: quote.asOf,
      quotedPrice: quote.price,
      deployableCash: gate.deployableCash,
      heldQuantity,
      sizing,
      requestedNotional,
      fractionalTradable,
      brokerPreviewAccepted: brokerPreview.accepted,
    },
  }]);
  const previewId = ids[0];
  if (!previewId) return fail(503, 'PREVIEW_PERSISTENCE_FAILED', 'The approved preview could not be stored, so it cannot be executed.');

  await recordAudit({
    category: 'order',
    action: 'agentic_live_preview',
    severity: 'info',
    message: `Created single-use live ${side.toUpperCase()} ${symbol} preview ${previewId}.`,
    detail: { previewId, accountId: account.id, symbol, side, sizing, requestedNotional, quantity, estimatedTotal: gate.notional },
  });

  return json({
    approved: true,
    previewId,
    symbol,
    side,
    sizing,
    requestedNotional,
    account: { id: account.id, name: account.name, cash: account.cash },
    quote,
    quantity,
    heldQuantity,
    estimatedTotal: gate.notional,
    fractionalTradable,
    findings: gate.findings,
    brokerPreview,
    expiresInSeconds: 300,
    confirmationText: `${side.toUpperCase()} ${symbol}`,
  });
});
