import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { claimOrderPreview, recordAudit, setOrderPreviewStatus } from '../lib/store.mts';
import { SCHWAB_EXECUTION_SYMBOL, type SchwabAdapter } from '../../src/brokers/schwab/adapter.js';
import { validateLiveExecution } from '../../src/risk/execution.js';
import type { ProposedOrder } from '../../src/risk/types.js';

/**
 * POST /.netlify/functions/order-execute
 *
 * Live execution is deliberately narrow:
 *   - authenticated private session only
 *   - single-use, unexpired database preview
 *   - exact second-step confirmation text
 *   - Schwab production adapter only
 *   - BUY YMAG only
 *   - whole-share market order only
 *   - fresh Schwab account cash + quote revalidated immediately before submit
 *   - Schwab broker preview repeated immediately before submit
 */
export default withErrorHandling('order-execute', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Live trading is unavailable in public demo mode.');

  const body = await readJsonBody<{ previewId?: unknown; confirmation?: unknown }>(req);
  const previewId = typeof body?.previewId === 'number' && Number.isInteger(body.previewId) ? body.previewId : 0;
  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim().toUpperCase() : '';
  if (!previewId) return fail(400, 'PREVIEW_REQUIRED', 'A valid live trade preview is required.');
  if (confirmation !== `BUY ${SCHWAB_EXECUTION_SYMBOL}`) {
    return fail(400, 'CONFIRMATION_REQUIRED', `Type BUY ${SCHWAB_EXECUTION_SYMBOL} to confirm this order.`);
  }

  // Atomic transition from preview -> approved. A second request using the same
  // id cannot claim it, so double-clicks/replays cannot intentionally duplicate it.
  const preview = await claimOrderPreview(previewId);
  if (!preview) {
    return fail(409, 'PREVIEW_UNAVAILABLE', 'This preview is expired, blocked, already used, or no longer available. Create a new preview.');
  }

  if (
    preview.broker !== 'schwab' ||
    preview.symbol.toUpperCase() !== SCHWAB_EXECUTION_SYMBOL ||
    preview.side !== 'buy' ||
    preview.orderType !== 'market' ||
    preview.quantity == null ||
    !Number.isInteger(preview.quantity) ||
    preview.quantity <= 0
  ) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(409, 'PREVIEW_POLICY_MISMATCH', 'The stored preview does not match the permitted YMAG execution policy.');
  }

  const ctx = await buildServerContext();
  const adapter = ctx.adapters.find((item) => item.id === 'schwab') as SchwabAdapter | undefined;
  if (!adapter || !adapter.capabilities.includes('place_order')) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(403, 'SCHWAB_EXECUTION_DISABLED', 'The guarded Schwab execution path is not enabled in this deployment.');
  }

  const [accountData, quote] = await Promise.all([
    adapter.getAccountData(),
    adapter.getQuote(SCHWAB_EXECUTION_SYMBOL),
  ]);
  const account = accountData.accounts.find((item) => item.id === preview.accountExternalId && item.broker === 'schwab');
  if (!account || !account.tradeEligible) {
    await setOrderPreviewStatus(previewId, 'rejected');
    return fail(409, 'SCHWAB_ACCOUNT_NOT_TRADE_ELIGIBLE', 'The selected Schwab account is no longer trade-eligible.');
  }

  const gate = validateLiveExecution({
    symbol: SCHWAB_EXECUTION_SYMBOL,
    side: 'buy',
    orderType: 'market',
    quantity: preview.quantity,
    price: quote.price,
    brokerCash: account.cash,
    brokerCashFloor: ctx.config.brokerCashFloor,
    maxOrderNotional: ctx.config.maxOrderNotional,
    killSwitch: ctx.config.killSwitch,
    executionEnabled: true,
  });

  if (!gate.approved) {
    await setOrderPreviewStatus(previewId, 'rejected');
    await recordAudit({
      category: 'risk',
      action: 'ymag_execution_revalidation_blocked',
      severity: 'warning',
      message: `Live execution of preview ${previewId} was blocked during final revalidation.`,
      detail: { previewId, findingCodes: gate.findings.map((finding) => finding.code) },
    });
    return fail(409, 'EXECUTION_REVALIDATION_FAILED', 'Market price, available cash, or policy changed. Create a new preview.', {
      findings: gate.findings,
    });
  }

  const order: ProposedOrder = {
    id: `execute-${previewId}`,
    accountId: account.id,
    broker: 'schwab',
    symbol: SCHWAB_EXECUTION_SYMBOL,
    side: 'buy',
    quantity: preview.quantity,
    orderType: 'market',
    rationale: preview.rationale,
    origin: 'manual',
    fundingSource: 'broker_cash',
    sleeve: 'income_engine',
  };

  // Repeat Schwab's broker-side preview after the local preview is claimed and
  // immediately before the live POST. A preview failure is a definite no-submit.
  try {
    const brokerPreview = await adapter.previewOrder(order);
    if (!brokerPreview.accepted) {
      await setOrderPreviewStatus(previewId, 'rejected');
      return fail(409, 'SCHWAB_PREVIEW_REJECTED', 'Schwab rejected the final broker-side preview. No order was submitted.');
    }
  } catch (error) {
    await setOrderPreviewStatus(previewId, 'rejected');
    await recordAudit({
      category: 'order',
      action: 'ymag_broker_preview_failed',
      severity: 'warning',
      message: `Final Schwab preview failed for stored preview ${previewId}. No placement was attempted.`,
    });
    throw error;
  }

  try {
    const status = await adapter.placeOrder(order);
    await setOrderPreviewStatus(previewId, 'placed');
    await recordAudit({
      category: 'order',
      action: 'ymag_order_submitted',
      severity: 'info',
      message: `Submitted human-approved YMAG order from preview ${previewId}.`,
      detail: {
        previewId,
        brokerOrderId: status.brokerOrderId,
        accountId: account.id,
        quantity: preview.quantity,
        estimatedNotional: gate.notional,
        quoteAsOf: quote.asOf,
      },
    });
    return json({
      executed: true,
      previewId,
      symbol: SCHWAB_EXECUTION_SYMBOL,
      quantity: preview.quantity,
      estimatedNotional: gate.notional,
      quote,
      order: status,
      note: 'Schwab accepted the order submission. Broker order history remains the source of truth for fill price and final status.',
    });
  } catch (error) {
    // Once placement is attempted, a transport failure can be ambiguous. Never
    // automatically retry: mark it unknown and require reconciliation against
    // Schwab order history before another order is created.
    await setOrderPreviewStatus(previewId, 'submission_unknown');
    await recordAudit({
      category: 'order',
      action: 'ymag_submission_unknown',
      severity: 'error',
      message: `Placement outcome for preview ${previewId} could not be confirmed. Do not retry automatically; reconcile Schwab order history first.`,
      detail: { previewId, accountId: account.id, quantity: preview.quantity },
    });
    throw error;
  }
});
