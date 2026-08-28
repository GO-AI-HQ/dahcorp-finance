import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { databaseAvailable, recordAudit, saveOrderPreviews } from '../lib/store.mts';
import { SCHWAB_EXECUTION_SYMBOL, type SchwabAdapter } from '../../src/brokers/schwab/adapter.js';
import { validateLiveExecution } from '../../src/risk/execution.js';
import type { ProposedOrder } from '../../src/risk/types.js';

/** POST /.netlify/functions/schwab-trade-preview */
export default withErrorHandling('schwab-trade-preview', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Live trading is unavailable in public demo mode.');
  if (!databaseAvailable()) {
    return fail(503, 'DATABASE_REQUIRED', 'Netlify Database is required for single-use live trade previews.');
  }

  const body = await readJsonBody<{ accountId?: unknown; quantity?: unknown }>(req);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  const quantity = typeof body?.quantity === 'number' ? body.quantity : Number.NaN;
  if (!accountId || !Number.isInteger(quantity) || quantity <= 0) {
    return fail(400, 'INVALID_YMAG_ORDER', 'Choose a Schwab account and enter a positive whole-share YMAG quantity.');
  }

  const ctx = await buildServerContext();
  const adapter = ctx.adapters.find((item) => item.id === 'schwab') as SchwabAdapter | undefined;
  if (!adapter || !adapter.isConfigured()) {
    return fail(503, 'SCHWAB_NOT_CONFIGURED', 'Schwab production credentials are not configured.');
  }
  if (!adapter.capabilities.includes('place_order')) {
    return fail(403, 'SCHWAB_EXECUTION_DISABLED', 'Schwab is connected read-only. Enable the guarded execution deployment flag first.');
  }

  const [accountData, quote] = await Promise.all([
    adapter.getAccountData(),
    adapter.getQuote(SCHWAB_EXECUTION_SYMBOL),
  ]);
  const account = accountData.accounts.find((item) => item.id === accountId && item.broker === 'schwab');
  if (!account || !account.tradeEligible) {
    return fail(400, 'SCHWAB_ACCOUNT_NOT_TRADE_ELIGIBLE', 'The selected Schwab account is not eligible for live trading.');
  }

  const gate = validateLiveExecution({
    symbol: SCHWAB_EXECUTION_SYMBOL,
    side: 'buy',
    orderType: 'market',
    quantity,
    price: quote.price,
    brokerCash: account.cash,
    brokerCashFloor: ctx.config.brokerCashFloor,
    maxOrderNotional: ctx.config.maxOrderNotional,
    killSwitch: ctx.config.killSwitch,
    executionEnabled: true,
  });

  if (!gate.approved) {
    await recordAudit({
      category: 'risk',
      action: 'ymag_live_preview_blocked',
      severity: 'warning',
      message: 'A YMAG live-trade preview was blocked by the deterministic execution gate.',
      detail: { accountId, quantity, findingCodes: gate.findings.map((finding) => finding.code) },
    });
    return json({
      approved: false,
      previewId: null,
      symbol: SCHWAB_EXECUTION_SYMBOL,
      account: { id: account.id, name: account.name, cash: account.cash },
      quote,
      quantity,
      estimatedTotal: gate.notional,
      findings: gate.findings,
      expiresInSeconds: 0,
      confirmationText: null,
    });
  }

  const order: ProposedOrder = {
    id: `live-preview-${Date.now()}`,
    accountId: account.id,
    broker: 'schwab',
    symbol: SCHWAB_EXECUTION_SYMBOL,
    side: 'buy',
    quantity,
    orderType: 'market',
    rationale: 'Human-initiated YMAG accumulation from DAHCorp Finance.',
    origin: 'manual',
    fundingSource: 'broker_cash',
    sleeve: 'income_engine',
  };

  const brokerPreview = await adapter.previewOrder(order);
  if (!brokerPreview.accepted) {
    return fail(409, 'SCHWAB_PREVIEW_REJECTED', 'Schwab did not accept the broker-side order preview.');
  }

  const ids = await saveOrderPreviews([
    {
      recommendationId: null,
      accountExternalId: account.id,
      broker: 'schwab',
      symbol: SCHWAB_EXECUTION_SYMBOL,
      side: 'buy',
      notional: gate.notional,
      quantity,
      orderType: 'market',
      limitPrice: null,
      origin: 'manual',
      sleeve: 'income_engine',
      rationale: order.rationale,
      approvedByRisk: true,
      allowedNotional: gate.notional,
      findings: gate.findings,
      impact: {
        quoteAsOf: quote.asOf,
        quotedPrice: quote.price,
        deployableCash: gate.deployableCash,
        brokerPreviewAccepted: brokerPreview.accepted,
      },
    },
  ]);
  const previewId = ids[0];
  if (!previewId) return fail(503, 'PREVIEW_PERSISTENCE_FAILED', 'The approved preview could not be stored, so it cannot be executed.');

  await recordAudit({
    category: 'order',
    action: 'ymag_live_preview',
    severity: 'info',
    message: `Created single-use live YMAG preview ${previewId}.`,
    detail: { previewId, accountId: account.id, quantity, estimatedTotal: gate.notional },
  });

  return json({
    approved: true,
    previewId,
    symbol: SCHWAB_EXECUTION_SYMBOL,
    account: { id: account.id, name: account.name, cash: account.cash },
    quote,
    quantity,
    estimatedTotal: gate.notional,
    findings: gate.findings,
    brokerPreview,
    expiresInSeconds: 300,
    confirmationText: `BUY ${SCHWAB_EXECUTION_SYMBOL}`,
  });
});
