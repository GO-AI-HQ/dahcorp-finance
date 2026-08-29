import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { databaseAvailable, recordAudit, saveOrderPreviews } from '../lib/store.mts';
import { ROBINHOOD_EXECUTION_SYMBOL, ROBINHOOD_MAX_EXECUTION_SYMBOLS, type RobinhoodAdapter } from '../../src/brokers/robinhood/adapter.js';
import { validateRobinhoodExecution } from '../../src/risk/execution.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';

/** POST /.netlify/functions/robinhood-trade-preview */
export default withErrorHandling('robinhood-trade-preview', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Live trading is unavailable in public demo mode.');
  if (!databaseAvailable()) return fail(503, 'DATABASE_REQUIRED', 'Netlify Database is required for single-use live trade previews.');

  const body = await readJsonBody<{ accountId?: unknown; quantity?: unknown; symbol?: unknown }>(req);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  const quantity = typeof body?.quantity === 'number' ? body.quantity : Number.NaN;
  const symbol = typeof body?.symbol === 'string' && body.symbol.trim() ? body.symbol.trim().toUpperCase() : ROBINHOOD_EXECUTION_SYMBOL;
  if (!accountId || !Number.isInteger(quantity) || quantity <= 0 || !symbol) {
    return fail(400, 'INVALID_AGENTIC_ORDER', 'Choose the Robinhood Agentic account, an approved strategy symbol, and a positive whole-share quantity.');
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

  const gate = validateRobinhoodExecution({
    symbol,
    side: 'buy',
    orderType: 'market',
    quantity,
    price: quote.price,
    brokerCash: account.cash,
    brokerCashFloor: ctx.config.brokerCashFloor,
    maxOrderNotional: ctx.config.maxOrderNotional,
    killSwitch: ctx.config.killSwitch,
    executionEnabled: true,
    allowlist: configuredAllowlist,
  });

  if (!gate.approved) {
    await recordAudit({
      category: 'risk',
      action: 'agentic_live_preview_blocked',
      severity: 'warning',
      message: `A ${symbol} live-trade preview was blocked by the deterministic Robinhood execution gate.`,
      detail: { accountId, symbol, quantity, findingCodes: gate.findings.map((finding) => finding.code) },
    });
    return json({
      approved: false,
      previewId: null,
      symbol,
      account: { id: account.id, name: account.name, cash: account.cash },
      quote,
      quantity,
      estimatedTotal: gate.notional,
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
    side: 'buy',
    quantity,
    orderType: 'market',
    rationale: `Human-initiated ${symbol} purchase from the approved DAHCorp Agentic strategy universe.`,
    origin: 'manual',
    fundingSource: 'broker_cash',
    sleeve: instrument.sleeve,
  };

  const brokerPreview = await adapter.previewOrder(order);
  if (!brokerPreview.accepted) return fail(409, 'ROBINHOOD_PREVIEW_REJECTED', 'Robinhood did not accept the broker-side order review.');

  const ids = await saveOrderPreviews([{
    recommendationId: null,
    accountExternalId: account.id,
    broker: 'robinhood',
    symbol,
    side: 'buy',
    notional: gate.notional,
    quantity,
    orderType: 'market',
    limitPrice: null,
    origin: 'manual',
    sleeve: instrument.sleeve,
    rationale: order.rationale,
    approvedByRisk: true,
    allowedNotional: gate.notional,
    findings: gate.findings,
    impact: { quoteAsOf: quote.asOf, quotedPrice: quote.price, deployableCash: gate.deployableCash, brokerPreviewAccepted: brokerPreview.accepted },
  }]);
  const previewId = ids[0];
  if (!previewId) return fail(503, 'PREVIEW_PERSISTENCE_FAILED', 'The approved preview could not be stored, so it cannot be executed.');

  await recordAudit({ category: 'order', action: 'agentic_live_preview', severity: 'info', message: `Created single-use live ${symbol} preview ${previewId}.`, detail: { previewId, accountId: account.id, symbol, quantity, estimatedTotal: gate.notional } });

  return json({
    approved: true,
    previewId,
    symbol,
    account: { id: account.id, name: account.name, cash: account.cash },
    quote,
    quantity,
    estimatedTotal: gate.notional,
    findings: gate.findings,
    brokerPreview,
    expiresInSeconds: 300,
    confirmationText: `BUY ${symbol}`,
  });
});
