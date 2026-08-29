import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { loadShadowEvidence } from '../lib/shadowStore.mts';
import { buildSignalsPayload } from '../../src/services/analysis.js';

function ratio(actual: number, target: number): number {
  return target <= 0 ? 1 : Math.max(0, Math.min(1, actual / target));
}

/** GET /.netlify/functions/agentic-readiness */
export default withErrorHandling('agentic-readiness', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const [ctx, evidence] = await Promise.all([buildServerContext(), loadShadowEvidence(12)]);
  const signalPayload = buildSignalsPayload(ctx);
  const allowlist = new Set(ctx.config.agenticGrowthAllowlist.map((symbol) => symbol.toUpperCase()));
  const strategySignals = signalPayload.signals.filter((signal) => allowlist.has(signal.symbol.toUpperCase()));
  const agentic = ctx.snapshot.accounts.find((account) => account.broker === 'robinhood' && account.tradeEligible) ?? null;

  const liveQuoteCount = [...allowlist].filter((symbol) => ctx.snapshot.quotes[symbol]?.dataQuality === 'live').length;
  const evaluableSignalCount = strategySignals.filter((signal) => signal.trend.status !== 'INSUFFICIENT_DATA').length;
  const marketEvidenceProgress = allowlist.size
    ? 0.5 * ratio(liveQuoteCount, allowlist.size) + 0.5 * ratio(evaluableSignalCount, allowlist.size)
    : 0;
  const outcomeTarget = Math.max(10, Math.ceil(ctx.config.shadowReadiness.minimumObservations * 0.5));

  const dimensions = [
    {
      key: 'brokerage',
      label: 'Live brokerage state',
      weight: 20,
      progress: agentic ? 1 : 0,
      detail: agentic
        ? `Robinhood Agentic is connected with $${agentic.cash.toFixed(2)} currently reported as cash/buying power.`
        : 'No trade-eligible Robinhood Agentic account is currently visible to the strategy engine.',
    },
    {
      key: 'market_evidence',
      label: 'Market evidence coverage',
      weight: 20,
      progress: marketEvidenceProgress,
      detail: `${liveQuoteCount}/${allowlist.size} approved symbols have live quotes; ${evaluableSignalCount}/${allowlist.size} currently have enough history for the deterministic trend framework.`,
    },
    {
      key: 'shadow_observations',
      label: 'Shadow observations',
      weight: 20,
      progress: ratio(evidence.totalObservations, ctx.config.shadowReadiness.minimumObservations),
      detail: `${evidence.totalObservations}/${ctx.config.shadowReadiness.minimumObservations} evidence observations recorded. Duplicate same-day strategy/symbol observations are ignored.`,
    },
    {
      key: 'market_days',
      label: 'Distinct market days',
      weight: 15,
      progress: ratio(evidence.distinctMarketDays, ctx.config.shadowReadiness.minimumTradingDays),
      detail: `${evidence.distinctMarketDays}/${ctx.config.shadowReadiness.minimumTradingDays} distinct market dates observed. More days matter more than repeated checks on one day.`,
    },
    {
      key: 'outcomes',
      label: 'Outcome calibration',
      weight: 15,
      progress: ratio(evidence.observationsWithOutcome, outcomeTarget),
      detail: `${evidence.observationsWithOutcome}/${outcomeTarget} Shadow observations have forward outcome checkpoints. This measures calibration; it does not mean an AI model retrained itself.`,
    },
    {
      key: 'intelligence',
      label: 'Policy & news intelligence',
      weight: 10,
      progress: 0,
      detail: 'Policy, macro/news, energy, congressional disclosure and institutional filing feeds are the next intelligence layer and are not yet counted as production evidence.',
    },
  ];

  const overall = Math.round(
    dimensions.reduce((sum, item) => sum + item.progress * item.weight, 0),
  );
  const stage = overall < 35 ? 'Observing' : overall < 65 ? 'Building evidence' : overall < 85 ? 'Calibrating' : 'Ready for human review';

  return json({
    asOf: ctx.snapshot.asOf,
    mode: ctx.config.agenticExecutionMode,
    overall,
    stage,
    explanation: 'Readiness is a transparent evidence-maturity score, not a claim that the AI is training itself or a forecast of investment performance.',
    allowlist: [...allowlist],
    cashQueue: {
      enabled: ctx.config.cashQueue.enabled,
      requireQualifiedSignal: ctx.config.cashQueue.requireQualifiedSignal,
      availableCash: agentic?.cash ?? 0,
    },
    dimensions,
    evidence: {
      totalObservations: evidence.totalObservations,
      distinctMarketDays: evidence.distinctMarketDays,
      observationsWithOutcome: evidence.observationsWithOutcome,
      actionCounts: evidence.actionCounts,
      symbolCounts: evidence.symbolCounts,
      latest: evidence.latest,
    },
  });
});
