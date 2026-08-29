import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { parseRecommendation } from '../../src/agent/schema.js';
import { validateOrders } from '../../src/risk/engine.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import { getRecommendation, saveActiveStrategyModel, saveOrderPreviews, setRecommendationAction } from '../lib/store.mts';
import { recordEventDecision } from '../lib/intelligenceStore.mts';

export default withErrorHandling('adopt-strategy', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;
  const body = await readJsonBody<{ recommendationId?: number; eventFingerprint?: string }>(req);
  const recommendationId = Number(body?.recommendationId);
  if (!Number.isInteger(recommendationId) || recommendationId <= 0) return fail(400, 'INVALID_RECOMMENDATION', 'A valid modeled recommendation is required.');

  const record = await getRecommendation(recommendationId);
  if (!record) return fail(404, 'RECOMMENDATION_NOT_FOUND', 'The modeled recommendation could not be found.');
  const brief = parseRecommendation(record.brief);
  if (!brief) return fail(409, 'INVALID_STORED_RECOMMENDATION', 'The stored strategy no longer matches the current recommendation contract.');

  const ctx = await buildServerContext();
  const orders: ProposedOrder[] = [...brief.legs]
    .sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1))
    .map((leg, index) => {
      const account = ctx.analysis.accounts.find((row) => row.account.id === leg.accountId)?.account;
      return {
        id: `adopt-${recommendationId}-${index}`,
        accountId: leg.accountId,
        broker: account?.broker ?? 'manual',
        symbol: leg.symbol,
        side: leg.side ?? 'buy',
        notional: leg.amount,
        orderType: 'market',
        rationale: leg.reason,
        origin: 'rebalance',
        fundingSource: leg.side === 'sell' ? undefined : 'broker_cash',
        sleeve: getInstrumentOrFallback(leg.symbol).sleeve,
      };
    });

  const riskDecision = validateOrders(orders, { asOf: ctx.snapshot.asOf, analysis: ctx.analysis, income: ctx.income, quotes: ctx.snapshot.quotes, config: ctx.config });
  const previewIds = await saveOrderPreviews(riskDecision.orders.map((validated) => ({
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
  })));

  await saveActiveStrategyModel({
    recommendationId,
    adoptedAt: new Date().toISOString(),
    headline: brief.headline,
    thesis: brief.thesis,
    legs: brief.legs,
    projection: (record.deterministicOutcome as Record<string, unknown> | null)?.modelingImpact,
    sourceEventFingerprint: body?.eventFingerprint ?? null,
    status: 'active_pending_execution',
  });
  await setRecommendationAction(recommendationId, 'approved', 'Adopted from Modeling Lab and staged for broker-specific execution.');
  if (body?.eventFingerprint) {
    await recordEventDecision(body.eventFingerprint, { recommendationId, adoptedAt: new Date().toISOString(), decision: brief.headline, status: 'active_pending_execution' });
  }

  const staged = riskDecision.orders.map((validated, index) => {
    const account = ctx.analysis.accounts.find((row) => row.account.id === validated.order.accountId)?.account;
    const quote = ctx.snapshot.quotes[validated.order.symbol];
    const estimatedQuantity = quote?.price && quote.price > 0 ? validated.allowedNotional / quote.price : null;
    let executionPath: 'robinhood_guarded' | 'schwab_ymag_guarded' | 'manual_required' | 'blocked' = 'manual_required';
    let instruction = 'This leg is part of the active strategy but does not yet have a DAHCorp live broker adapter. Execute it manually only after reviewing the staged evidence.';
    if (!validated.approved) {
      executionPath = 'blocked';
      instruction = 'Deterministic policy currently blocks this leg. Do not place it.';
    } else if (account?.broker === 'robinhood') {
      executionPath = 'robinhood_guarded';
      instruction = 'Open the Robinhood guarded preview. DAHCorp will recheck live buying power/position, quote, tradability and policy before asking for exact confirmation.';
    } else if (account?.broker === 'schwab' && validated.order.side === 'buy' && validated.order.symbol === 'YMAG') {
      executionPath = 'schwab_ymag_guarded';
      instruction = 'Open the Schwab 3085 guarded YMAG preview. Schwab remains whole-share execution, so the final quantity is recalculated from current cash and price.';
    }
    return {
      stagedPreviewId: previewIds[index] ?? null,
      broker: account?.broker ?? validated.order.broker,
      accountId: validated.order.accountId,
      symbol: validated.order.symbol,
      side: validated.order.side,
      requestedNotional: validated.order.notional ?? 0,
      allowedNotional: validated.allowedNotional,
      estimatedQuantity,
      approved: validated.approved,
      executionPath,
      instruction,
      findings: validated.findings,
    };
  });

  const brokersUsed = new Set(staged.filter((row) => row.approved).map((row) => row.broker));
  const crossBroker = brokersUsed.size > 1;
  return json({
    adopted: true,
    recommendationId,
    headline: brief.headline,
    riskDecision,
    staged,
    crossBroker,
    fundingInstruction: crossBroker
      ? 'This model spans more than one brokerage. DAHCorp does not move cash between Robinhood and Schwab. If a buy depends on proceeds from the other broker, complete that cash transfer separately and re-preview the buy after funds settle.'
      : null,
    note: 'The strategy is now active and its transaction legs are staged. No live order is placed until the relevant guarded broker preview and exact human confirmation are completed.',
  });
});
