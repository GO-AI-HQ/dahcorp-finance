import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { validateOrders } from '../../src/risk/engine.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { recordAudit, saveOrderPreviews } from '../lib/store.mts';

/**
 * POST /.netlify/functions/order-preview
 *
 * Validates proposed orders and returns a preview. This is as far as capital
 * movement goes in this build: the preview is a statement of what the
 * deterministic engine would permit, not an instruction to a broker. No broker
 * is contacted for execution here, and nothing is queued.
 */
interface PreviewRequestOrder {
  accountId?: unknown;
  symbol?: unknown;
  side?: unknown;
  notional?: unknown;
  quantity?: unknown;
  orderType?: unknown;
  limitPrice?: unknown;
  rationale?: unknown;
  origin?: unknown;
  recommendationId?: unknown;
}

const ORIGINS = new Set(['claude', 'harvest_rule', 'dip_rule', 'rebalance', 'manual']);

export default withErrorHandling('order-preview', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = await readJsonBody<{ orders?: PreviewRequestOrder[]; recommendationId?: number }>(req);
  const raw = Array.isArray(body?.orders) ? body!.orders : [];
  if (!raw.length) return fail(400, 'NO_ORDERS', 'At least one order is required.');
  if (raw.length > 10) return fail(400, 'TOO_MANY_ORDERS', 'A preview batch is limited to 10 orders.');

  const ctx = await buildServerContext();

  const orders: ProposedOrder[] = [];
  for (const [index, item] of raw.entries()) {
    const accountId = typeof item.accountId === 'string' ? item.accountId : '';
    const symbol = typeof item.symbol === 'string' ? item.symbol.toUpperCase().trim() : '';
    const side = item.side === 'sell' ? 'sell' : 'buy';
    if (!accountId || !symbol) return fail(400, 'INVALID_ORDER', `Order ${index + 1} is missing an account or symbol.`);

    const notional = typeof item.notional === 'number' && Number.isFinite(item.notional) ? item.notional : undefined;
    const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : undefined;
    if (notional == null && quantity == null) {
      return fail(400, 'INVALID_ORDER', `Order ${index + 1} needs either a notional amount or a share quantity.`);
    }

    const account = ctx.analysis.accounts.find((a) => a.account.id === accountId)?.account;
    const origin = typeof item.origin === 'string' && ORIGINS.has(item.origin) ? item.origin : 'manual';

    orders.push({
      id: `preview-${index}-${symbol}`,
      accountId,
      broker: account?.broker ?? 'manual',
      symbol,
      side,
      notional,
      quantity,
      orderType: item.orderType === 'limit' ? 'limit' : 'market',
      limitPrice: typeof item.limitPrice === 'number' ? item.limitPrice : undefined,
      rationale: typeof item.rationale === 'string' ? item.rationale.slice(0, 500) : 'Manual preview request.',
      origin: origin as ProposedOrder['origin'],
      sleeve: getInstrumentOrFallback(symbol).sleeve,
    });
  }

  const decision = validateOrders(orders, {
    asOf: ctx.snapshot.asOf,
    analysis: ctx.analysis,
    income: ctx.income,
    quotes: ctx.snapshot.quotes,
    config: ctx.config,
  });

  const recommendationId = typeof body?.recommendationId === 'number' ? body.recommendationId : null;
  await saveOrderPreviews(
    decision.orders.map((validated) => ({
      recommendationId,
      accountExternalId: validated.order.accountId,
      broker: validated.order.broker,
      symbol: validated.order.symbol,
      side: validated.order.side,
      notional: validated.order.notional ?? null,
      quantity: validated.order.quantity ?? null,
      orderType: validated.order.orderType,
      limitPrice: validated.order.limitPrice ?? null,
      origin: validated.order.origin,
      sleeve: validated.order.sleeve,
      rationale: validated.order.rationale,
      approvedByRisk: validated.approved,
      allowedNotional: validated.allowedNotional,
      findings: validated.findings,
      impact: validated.impact,
    })),
  );

  await recordAudit({
    category: 'order',
    action: 'preview',
    severity: decision.approved ? 'info' : 'warning',
    message: `Previewed ${orders.length} order(s); risk verdict ${decision.approved ? 'permitted' : 'not permitted'}.`,
    detail: {
      recommendationId,
      requestedTotal: decision.requestedTotal,
      allowedTotal: decision.allowedTotal,
      symbols: orders.map((o) => o.symbol),
    },
  });

  return json({
    asOf: ctx.snapshot.asOf,
    containsMockData: ctx.snapshot.containsMockData,
    decision,
    executionEnabled: false,
    note: 'Preview only. Execution is disabled in this build; no broker order was created or queued.',
  });
});
