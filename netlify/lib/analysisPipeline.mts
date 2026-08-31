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
import { loadStableAdvancedEvidenceFabric } from './intelligenceV3Stable.mts';
import { compactAdvancedEvidence } from './intelligenceContext.mts';
import { buildStrategyMutationProposals, loadIncomeIntelligence } from './incomeIntelligence.mts';

export async function prepareAnalysis(question: string, requestedCapital?: number) {
  // Read the latest stored research in parallel with the portfolio. Provider
  // refreshes happen separately so a user question does not wait on dozens of
  // outside data calls before the strategist can begin.
  const [ctx, intelligence, advanced, incomeResearch] = await Promise.all([
    buildServerContext(),
    buildMarketIntelligencePayload({ refresh: false, limit: 100 }),
    loadStableAdvancedEvidenceFabric(),
    loadIncomeIntelligence(),
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

  // Keep the model packet compact. The full event ledger and raw source
  // snapshots stay stored server-side; OpenAI/Claude receive decision-relevant
  // summaries, current coverage and provenance rather than a giant raw dump.
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
    deeperResearch: compactAdvancedEvidence(advanced),
    incomeResearch: incomeResearch ? {
      asOf: incomeResearch.asOf,
      sourceStatus: incomeResearch.sourceStatus,
      upcoming: incomeResearch.upcoming.slice(0, 24),
      candidates: incomeResearch.candidates.slice(0, 16),
      strategyChangeIdeas: buildStrategyMutationProposals(ctx, incomeResearch),
      rule: 'These are research candidates and portfolio-change proposals, not an expanded execution allowlist. A new symbol must still pass Modeling Lab, account fit, deterministic policy and investor approval.',
    } : { status: 'not_available' },
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
      : 'Safety rules';
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
    phaseNote: 'This is a recommendation only. Any broker action still has to pass the safety checks and the confirmation rules you have chosen.',
  };
}
