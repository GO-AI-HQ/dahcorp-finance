import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { claimOrderPreview, recordAudit, setOrderPreviewStatus } from '../lib/store.mts';
import { ROBINHOOD_MAX_EXECUTION_SYMBOLS, type RobinhoodAdapter } from '../../src/brokers/robinhood/adapter.js';
import { validateRobinhoodExecution } from '../../src/risk/execution.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';

/** POST /.netlify/functions/robinhood-order-execute */
export default withErrorHandling('robinhood-order-execute', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Live trading is unavailable in public demo mode.');

  const body = await readJsonBody<{ previewId?: unknown; confirmation?: unknown }>(req);
  const previewId = typeof body?.previewId === 'number' && Number.isInteger(body.previewId) ? body.previewId : 0;
  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim().toUpperCase() : '';
  if (!previewId) return fail(400, 'PREVIEW_REQUIRED', 'A valid live trade preview is required.');

  const preview = await claimOrderPreview(previewId);
  if (!preview) return fail(409, 'PREVIEW_UNAVAILABLE', 'This preview is expired, blocked, already used, or no longer available. Create a new preview.');
  const symbol = preview.symbol.toUpperCase();
  if (confirmation !== `BUY ${symbol}`) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(400, 'CONFIRMATION_REQUIRED', `Type BUY ${symbol} to confirm this order.`);
  }

  if (
    preview.broker !== 'robinhood' ||
    !ROBINHOOD_MAX_EXECUTION_SYMBOLS.includes(symbol as (typeof ROBINHOOD_MAX_EXECUTION_SYMBOLS)[number]) ||
    preview.side !== 'buy' ||
    preview.orderType !== 'market' ||
    preview.quantity == null || !Number.isInteger(preview.quantity) || preview.quantity <= 0
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

  const gate = validateRobinhoodExecution({
    symbol,
    side: 'buy',
    orderType: 'market',
    quantity: preview.quantity,
    price: quote.price,
    brokerCash: account.cash,
    brokerCashFloor: ctx.config.brokerCashFloor,
    maxOrderNotional: ctx.config.maxOrderNotional,
    killSwitch: ctx.config.killSwitch,
    executionEnabled: true,
    allowlist: configuredAllowlist,
  });
  if (!gate.approved) {
    await setOrderPreviewStatus(previewId, 'rejected');
    await recordAudit({ category: 'risk', action: 'agentic_execution_revalidation_blocked', severity: 'warning', message: `Live Robinhood execution of ${symbol} preview ${previewId} was blocked during final revalidation.`, detail: { previewId, symbol, findingCodes: gate.findings.map((finding) => finding.code) } });
    return fail(409, 'EXECUTION_REVALIDATION_FAILED', 'Market price, Agentic buying power, or policy changed. Create a new preview.', { findings: gate.findings });
  }

  const instrument = getInstrumentOrFallback(symbol);
  const order: ProposedOrder = {
    id: `robinhood-execute-${previewId}`,
    accountId: account.id,
    broker: 'robinhood',
    symbol,
    side: 'buy',
    quantity: preview.quantity,
    orderType: 'market',
    rationale: preview.rationale,
    origin: 'manual',
    fundingSource: 'broker_cash',
    sleeve: instrument.sleeve,
  };

  try {
    const brokerReview = await adapter.previewOrder(order);
    if (!brokerReview.accepted) {
      await setOrderPreviewStatus(previewId, 'rejected');
      return fail(409, 'ROBINHOOD_PREVIEW_REJECTED', 'Robinhood rejected the final broker-side review. No order was submitted.');
    }
  } catch (error) {
    await setOrderPreviewStatus(previewId, 'rejected');
    await recordAudit({ category: 'order', action: 'agentic_broker_review_failed', severity: 'warning', message: `Final Robinhood review failed for ${symbol} preview ${previewId}. No placement was attempted.` });
    throw error;
  }

  try {
    const status = await adapter.placeOrder(order);
    await setOrderPreviewStatus(previewId, 'placed');
    await recordAudit({
      category: 'order',
      action: 'agentic_order_submitted',
      severity: 'info',
      message: `Submitted human-approved ${symbol} order from preview ${previewId}.`,
      detail: { previewId, symbol, brokerOrderId: status.brokerOrderId, accountId: account.id, quantity: preview.quantity, estimatedNotional: gate.notional, quoteAsOf: quote.asOf },
    });
    return json({
      executed: true,
      previewId,
      symbol,
      quantity: preview.quantity,
      estimatedNotional: gate.notional,
      quote,
      order: status,
      note: 'Robinhood accepted the order request. Robinhood order history remains the source of truth for fill price and final status.',
    });
  } catch (error) {
    await setOrderPreviewStatus(previewId, 'submission_unknown');
    await recordAudit({ category: 'order', action: 'agentic_submission_unknown', severity: 'error', message: `Placement outcome for ${symbol} preview ${previewId} could not be confirmed. Do not retry automatically; reconcile Robinhood order history first.`, detail: { previewId, symbol, accountId: account.id, quantity: preview.quantity } });
    throw error;
  }
});
