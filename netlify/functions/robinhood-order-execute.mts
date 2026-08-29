import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { claimOrderPreview, recordAudit, setOrderPreviewStatus } from '../lib/store.mts';
import { ROBINHOOD_MAX_EXECUTION_SYMBOLS, type RobinhoodAdapter } from '../../src/brokers/robinhood/adapter.js';
import { validateRobinhoodExecution } from '../../src/risk/execution.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';

function sixDecimals(value: number): number {
  return Math.floor(value * 1_000_000 + 1e-9) / 1_000_000;
}

/**
 * POST /.netlify/functions/robinhood-order-execute
 *
 * Executes a previously broker-reviewed, single-use Robinhood preview after an
 * exact human confirmation. BUY and SELL are supported for the configured
 * Agentic universe. The stored preview is never trusted as current: account,
 * position, quote, fractional eligibility, allowlist and risk limits are all
 * re-read immediately before a second Robinhood review and placement.
 */
export default withErrorHandling('robinhood-order-execute', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Live trading is unavailable in public demo mode.');

  const body = await readJsonBody<{ previewId?: unknown; confirmation?: unknown }>(req);
  const previewId = typeof body?.previewId === 'number' && Number.isInteger(body.previewId) ? body.previewId : 0;
  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim().toUpperCase() : '';
  if (!previewId) return fail(400, 'PREVIEW_REQUIRED', 'A valid live trade preview is required.');

  // Atomic single-use boundary. A second request cannot intentionally reuse the
  // same preview after this claim succeeds.
  const preview = await claimOrderPreview(previewId);
  if (!preview) return fail(409, 'PREVIEW_UNAVAILABLE', 'This preview is expired, blocked, already used, or no longer available. Create a new preview.');

  const symbol = preview.symbol.toUpperCase();
  const side = preview.side === 'sell' ? 'sell' : preview.side === 'buy' ? 'buy' : null;
  if (!side) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(409, 'PREVIEW_POLICY_MISMATCH', 'The stored preview has an unsupported order side.');
  }
  const requiredConfirmation = `${side.toUpperCase()} ${symbol}`;
  if (confirmation !== requiredConfirmation) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(400, 'CONFIRMATION_REQUIRED', `Type ${requiredConfirmation} to confirm this order.`);
  }

  if (
    preview.broker !== 'robinhood' ||
    !ROBINHOOD_MAX_EXECUTION_SYMBOLS.includes(symbol as (typeof ROBINHOOD_MAX_EXECUTION_SYMBOLS)[number]) ||
    preview.orderType !== 'market' ||
    preview.quantity == null ||
    !Number.isFinite(preview.quantity) ||
    preview.quantity <= 0
  ) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(409, 'PREVIEW_POLICY_MISMATCH', 'The stored preview does not match the permitted Robinhood Agentic execution policy.');
  }

  const ctx = await buildServerContext();
  const configuredAllowlist = ctx.config.agenticGrowthAllowlist.map((item) => item.toUpperCase());
  if (ctx.config.agenticExecutionMode === 'shadow' || !configuredAllowlist.includes(symbol)) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(403, 'AGENTIC_POLICY_CHANGED', 'The Agentic execution mode or strategy allowlist changed after this preview. No order was submitted.');
  }

  const adapter = ctx.adapters.find((item) => item.id === 'robinhood') as RobinhoodAdapter | undefined;
  if (!adapter || !adapter.capabilities.includes('place_order')) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(403, 'ROBINHOOD_EXECUTION_DISABLED', 'The guarded Robinhood execution path is not enabled in this deployment.');
  }

  const [accountData, quote] = await Promise.all([
    adapter.getAccountData(),
    adapter.getQuote(symbol),
  ]);
  const account = accountData.accounts.find((item) => item.id === preview.accountExternalId && item.broker === 'robinhood');
  if (!account || !account.tradeEligible) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(409, 'ROBINHOOD_AGENTIC_ACCOUNT_REQUIRED', 'The selected account is not currently an Agentic trade-eligible Robinhood account.');
  }

  const impact = preview.impact && typeof preview.impact === 'object' ? preview.impact as Record<string, unknown> : {};
  const sizing = impact.sizing === 'notional' ? 'notional' : 'quantity';
  const requestedNotional = typeof impact.requestedNotional === 'number' && Number.isFinite(impact.requestedNotional) && impact.requestedNotional > 0
    ? impact.requestedNotional
    : preview.notional != null && Number.isFinite(preview.notional) && preview.notional > 0
      ? preview.notional
      : null;

  // A dollar-sized request is re-sized at the fresh quote so the requested
  // dollars remain the intent. Quantity-sized requests preserve the exact share
  // amount the investor previewed.
  const quantity = sizing === 'notional' && requestedNotional != null
    ? sixDecimals(requestedNotional / quote.price)
    : preview.quantity;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(409, 'EXECUTION_SIZE_INVALID', 'The stored order can no longer be sized safely at the current market price. Create a new preview.');
  }

  const holding = accountData.holdings.find((item) => item.accountId === account.id && item.symbol.toUpperCase() === symbol);
  const heldQuantity = holding?.shares ?? 0;
  const fractional = Math.abs(quantity - Math.round(quantity)) > 1e-9;
  const fractionalTradable = fractional ? await adapter.getFractionalTradability(symbol) : null;

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
    await setOrderPreviewStatus(previewId, 'rejected');
    await recordAudit({
      category: 'risk',
      action: 'agentic_execution_revalidation_blocked',
      severity: 'warning',
      message: `Live Robinhood ${side.toUpperCase()} ${symbol} preview ${previewId} was blocked during final revalidation.`,
      detail: { previewId, symbol, side, sizing, quantity, findingCodes: gate.findings.map((finding) => finding.code) },
    });
    return fail(409, 'EXECUTION_REVALIDATION_FAILED', 'Market price, buying power/position, tradability, or policy changed. Create a new preview.', { findings: gate.findings });
  }

  const instrument = getInstrumentOrFallback(symbol);
  const order: ProposedOrder = {
    id: `robinhood-execute-${previewId}`,
    accountId: account.id,
    broker: 'robinhood',
    symbol,
    side,
    quantity,
    // Preserve a dollar-sized BUY when Robinhood's live MCP schema supports a
    // dollar/notional field. The adapter otherwise falls back to the re-sized
    // fractional quantity above. SELL remains quantity-bounded by live shares.
    notional: side === 'buy' && sizing === 'notional' && requestedNotional != null ? requestedNotional : undefined,
    orderType: 'market',
    rationale: preview.rationale,
    origin: preview.origin === 'agent' ? 'agent' : 'manual',
    fundingSource: side === 'buy' ? 'broker_cash' : undefined,
    sleeve: instrument.sleeve,
  };

  // Second broker-side review after all fresh revalidation and immediately
  // before placement. A review failure is a definite no-submit.
  try {
    const brokerReview = await adapter.previewOrder(order);
    if (!brokerReview.accepted) {
      await setOrderPreviewStatus(previewId, 'rejected');
      return fail(409, 'ROBINHOOD_PREVIEW_REJECTED', 'Robinhood rejected the final broker-side review. No order was submitted.');
    }
  } catch (error) {
    await setOrderPreviewStatus(previewId, 'rejected');
    await recordAudit({
      category: 'order',
      action: 'agentic_broker_review_failed',
      severity: 'warning',
      message: `Final Robinhood review failed for ${side.toUpperCase()} ${symbol} preview ${previewId}. No placement was attempted.`,
    });
    throw error;
  }

  try {
    const status = await adapter.placeOrder(order);
    await setOrderPreviewStatus(previewId, 'placed');
    await recordAudit({
      category: 'order',
      action: 'agentic_order_submitted',
      severity: 'info',
      message: `Submitted human-approved ${side.toUpperCase()} ${symbol} order from preview ${previewId}.`,
      detail: {
        previewId,
        symbol,
        side,
        sizing,
        requestedNotional,
        brokerOrderId: status.brokerOrderId,
        accountId: account.id,
        quantity,
        estimatedNotional: gate.notional,
        quoteAsOf: quote.asOf,
      },
    });
    return json({
      executed: true,
      previewId,
      symbol,
      side,
      sizing,
      requestedNotional,
      quantity,
      estimatedNotional: gate.notional,
      quote,
      order: status,
      note: 'Robinhood accepted the order request. Robinhood order history remains the source of truth for fill price, final quantity, and final status.',
    });
  } catch (error) {
    // Placement transport failures are ambiguous. Never auto-retry; reconciliation
    // against Robinhood order history is mandatory before another order is made.
    await setOrderPreviewStatus(previewId, 'submission_unknown');
    await recordAudit({
      category: 'order',
      action: 'agentic_submission_unknown',
      severity: 'error',
      message: `Placement outcome for ${side.toUpperCase()} ${symbol} preview ${previewId} could not be confirmed. Do not retry automatically; reconcile Robinhood order history first.`,
      detail: { previewId, symbol, side, accountId: account.id, quantity, requestedNotional },
    });
    throw error;
  }
});
