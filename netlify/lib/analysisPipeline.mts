import { buildServerContext } from './context.mts';
import { buildPlan, buildSignalsPayload, investableCapital } from '../../src/services/analysis.js';
import { buildAgentDigest } from '../../src/agent/digest.js';
import { buildDeterministicBrief } from '../../src/agent/fallback.js';
import type { AgentResult } from '../../src/agent/types.js';
import { validateAllocation, validateOrders } from '../../src/risk/engine.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { recordAudit, saveRecommendation } from './store.mts';
import type { ProposedOrder } from '../../src/risk/types.js';
import type { AgentRequest } from './agentModel.mts';
import { buildMarketIntelligencePayload } from './intelligenceEngine.mts';

export async function prepareAnalysis(question: string, requestedCapital?: number) {
  // Read the latest persisted production intelligence in parallel with the
  // portfolio snapshot. Provider refreshes happen on the hourly observer so an
  // Analyze request never blocks on dozens of external intelligence calls.
  const [ctx, intelligence] = await Promise.all([
    buildServerContext(),
    buildMarketIntelligencePayload({ refresh: false, limit: 100 }),
  ]);
  const signals = buildSignalsPayload(ctx);
  const policyCapital = investableCapital(ctx);
  const requested = typeof requestedCapital === 'number' && Number.isFinite(requestedCapital) ? requestedCapital : policyCapital;
  const capital = Math.max(0, Math.min(requested, policyCapital));
  const plan = buildPlan(ctx, capital);
  const digest = buildAgentDigest({
    ctx,
    plan,
    opportunities: signals.opportunities,
    semis: signals.semis,
    drag: signals.drag,
    capital,
  });
  const deterministicBrief = buildDeterministicBrief({
    ctx,
    plan,
    opportunities: signals.opportunities,
    semis: signals.semis,
    drag: signals.drag,
    question,
  });

  // Deliberately compact the evidence packet before it reaches an LLM. The
  // complete ledger remains persisted; Terra receives the most decision-relevant
  // recent evidence plus normalized macro/reference state and provenance.
  const eventIntelligence = {
    asOf: intelligence.asOf,
    providers: intelligence.providers,
    pulses: intelligence.pulses,
    marketPulse: intelligence.marketPulse,
    macroRegime: intelligence.macroRegime,
    economicCalendar: intelligence.economicCalendar.slice(0, 24),
    referenceRegistry: intelligence.referenceRegistry,
    governmentTrading: intelligence.governmentTrading.slice(0, 20),
    capitalSignals: intelligence.capitalSignals.slice(0, 20),
    policyEvents: intelligence.policyEvents.slice(0, 20),
    events: intelligence.events.slice(0, 60),
    note: intelligence.note,
  };

  return { ctx, signals, capital, plan, digest, deterministicBrief, eventIntelligence };
}

export type PreparedAnalysis = Awaited<ReturnType<typeof prepareAnalysis>>;

export function agentRequestFor(question: string, prepared: PreparedAnalysis): AgentRequest {
  return {
    question,
    digest: prepared.digest,
    capital: prepared.capital,
    config: prepared.ctx.config,
    eventIntelligence: prepared.eventIntelligence,
    deterministicBrief: prepared.deterministicBrief,
  };
}

export async function finalizePreparedAnalysis(
  question: string,
  prepared: PreparedAnalysis,
  agent: AgentResult,
  modelInputAsOf = prepared.ctx.snapshot.asOf,
) {
  const { ctx, signals, capital, plan, digest } = prepared;
  const riskContext = {
    asOf: ctx.snapshot.asOf,
    analysis: ctx.analysis,
    income: ctx.income,
    quotes: ctx.snapshot.quotes,
    config: ctx.config,
  };

  const orders: ProposedOrder[] = [...agent.brief.legs]
    .sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1))
    .map((leg, index) => {
      const account = ctx.analysis.accounts.find((row) => row.account.id === leg.accountId)?.account;
      return {
        id: `agent-${index}-${leg.symbol}`,
        accountId: leg.accountId,
        broker: account?.broker ?? 'manual',
        symbol: leg.symbol,
        side: leg.side ?? 'buy',
        notional: leg.amount,
        orderType: 'market',
        rationale: leg.reason,
        origin: 'agent',
        fundingSource: leg.side === 'sell' ? undefined : 'broker_cash',
        sleeve: getInstrumentOrFallback(leg.symbol).sleeve,
      };
    });

  const riskDecision = validateOrders(orders, riskContext);
  const baselineDecision = validateAllocation(
    plan.legs.map((leg) => ({
      symbol: leg.symbol,
      amount: leg.amount,
      accountId: leg.accountId,
      sleeve: leg.sleeve,
    })),
    riskContext,
  );

  const recommendationId = await saveRecommendation({
    question,
    availableCapital: capital,
    source: agent.source,
    model: agent.model,
    headline: agent.brief.headline,
    confidence: agent.brief.confidence,
    brief: agent.brief,
    portfolioSnapshot: digest,
    deterministicOutcome: {
      plan,
      riskDecision,
      baselineDecision,
      modelInputAsOf,
      riskSnapshotAsOf: ctx.snapshot.asOf,
    },
  });

  const sourceLabel = agent.source === 'openai'
    ? `OpenAI (${agent.model})`
    : agent.source === 'claude'
      ? `Claude (${agent.model})`
      : 'Deterministic policy';
  await recordAudit({
    category: 'agent',
    action: 'analyze',
    severity: riskDecision.approved ? 'info' : 'warning',
    message: `${sourceLabel}: ${agent.brief.headline}`,
    detail: {
      recommendationId,
      question,
      capital,
      source: agent.source,
      model: agent.model,
      modelInputAsOf,
      riskSnapshotAsOf: ctx.snapshot.asOf,
      riskApproved: riskDecision.approved,
      blockedCodes: riskDecision.orders
        .flatMap((o) => o.findings)
        .filter((f) => f.severity === 'block')
        .map((f) => f.code),
      fallbackReason: agent.fallbackReason,
    },
  });

  return {
    asOf: ctx.snapshot.asOf,
    modelInputAsOf,
    containsMockData: ctx.snapshot.containsMockData,
    sourceNotes: ctx.snapshot.sourceNotes,
    recommendationId,
    question,
    capital,
    brief: agent.brief,
    source: agent.source,
    model: agent.model,
    fallbackReason: agent.fallbackReason,
    usage: agent.usage,
    riskDecision,
    baseline: { plan, riskDecision: baselineDecision },
    executionEnabled: false,
    phaseNote: 'Analysis is advisory. Live execution remains governed by broker-specific preview, confirmation and reconciliation.',
  };
}
