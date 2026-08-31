import { buildServerContext } from './context.mts';
import { loadPreparedAnalysisContext } from './preparedPortfolioSnapshot.mts';
import { loadPreparedMarketPayload } from './preparedMarketSnapshot.mts';
import { loadPreparedIntelligenceSnapshot } from './preparedIntelligenceSnapshot.mts';
import { buildPlan, buildSignalsPayload, investableCapital } from '../../src/services/analysis.js';
import { buildAgentDigest } from '../../src/agent/digest.js';
import { buildDeterministicBrief } from '../../src/agent/fallback.js';
import type { AgentResult } from '../../src/agent/types.js';
import type { ModelDataProvenance } from '../../src/agent/provenance.js';
import { validateAllocation, validateOrders } from '../../src/risk/engine.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { recordAudit, saveRecommendation } from './store.mts';
import type { ProposedOrder } from '../../src/risk/types.js';
import type { AgentRequest } from './agentModel.mts';
import { buildMarketIntelligencePayload } from './intelligenceEngine.mts';
import { loadStableAdvancedEvidenceFabric } from './intelligenceV3Stable.mts';
import { compactAdvancedEvidence } from './intelligenceContext.mts';
import { buildStrategyMutationProposals, loadIncomeIntelligence } from './incomeIntelligence.mts';

function uniqueDistributionSymbols(rows: { symbol: string }[]): number {
  return new Set(rows.map((row) => row.symbol.toUpperCase())).size;
}

export async function prepareAnalysis(question: string, requestedCapital?: number) {
  // Model analysis follows the same snapshot-first plane as Portfolio, Income
  // and Strategy Lab. Stored research is loaded in parallel; no provider refresh
  // is triggered by a user question. Live broker/market context exists only as
  // the explicit cold-start fallback when no usable prepared portfolio exists.
  const [preparedCtx, intelligence, preparedMarket, preparedIntelligence, incomeResearch] = await Promise.all([
    loadPreparedAnalysisContext(),
    buildMarketIntelligencePayload({ refresh: false, limit: 100 }),
    loadPreparedMarketPayload(),
    loadPreparedIntelligenceSnapshot(),
    loadIncomeIntelligence(),
  ]);
  const ctx = preparedCtx ?? await buildServerContext();
  const advanced = preparedIntelligence?.payload.advancedEvidenceV3 ?? await loadStableAdvancedEvidenceFabric();
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

  const preparedMode = Boolean(preparedCtx);
  const marketEvidence = preparedMarket?.payload.evidence;
  const retainedEvidenceCount = marketEvidence
    ? [...marketEvidence.quotes, ...marketEvidence.history, ...marketEvidence.distributions].filter((row) => row.retained).length
    : 0;
  const dataProvenance: ModelDataProvenance = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    preparation: {
      readMode: preparedMode ? 'prepared_snapshot' : 'live_cold_start_fallback',
      providerCallsDuringPreparation: preparedMode ? 'none' : 'cold_start_broker_and_market_fallback',
    },
    portfolio: {
      asOf: ctx.snapshot.asOf,
      preparedAt: preparedCtx?.preparedAt ?? null,
      freshness: preparedCtx?.preparedFreshness ?? null,
      dataQuality: ctx.snapshot.dataQuality,
      containsMockData: ctx.snapshot.containsMockData,
      marketReadMode: preparedCtx?.preparedMarketReadMode ?? 'live_cold_start_fallback',
    },
    market: {
      source: !preparedMode
        ? 'live_cold_start_fallback'
        : preparedMarket
          ? 'prepared_market_snapshot'
          : 'portfolio_snapshot_embedded',
      builtAt: preparedMarket?.payload.builtAt ?? null,
      freshness: preparedMarket?.freshness ?? null,
      quoteSymbolCount: preparedMarket ? Object.keys(preparedMarket.payload.quotes).length : Object.keys(ctx.snapshot.quotes).length,
      historySymbolCount: preparedMarket ? Object.keys(preparedMarket.payload.priceHistory).length : Object.keys(ctx.snapshot.priceHistory).length,
      distributionSymbolCount: preparedMarket
        ? preparedMarket.payload.evidence.distributions.length
        : uniqueDistributionSymbols(ctx.snapshot.distributions),
      retainedEvidenceCount,
    },
    intelligence: {
      source: preparedIntelligence ? 'prepared_intelligence_snapshot' : 'stable_evidence_ledger_fallback',
      builtAt: preparedIntelligence?.payload.builtAt ?? null,
      freshness: preparedIntelligence?.freshness ?? null,
      coveragePct: advanced.fusion.coveragePct,
      liveLaneCount: advanced.fusion.liveLaneCount,
      partialLaneCount: advanced.fusion.partialLaneCount,
      unavailableLaneCount: advanced.fusion.unavailableLaneCount,
      expandedFinnhubCompanyCount: preparedIntelligence?.payload.finnhubExpandedEarnings.evidence.length ?? null,
    },
    constraints: [
      'Prepared and retained evidence supports display, research and planning only; it is not execution state or execution pricing.',
      'Missing or expired evidence remains UNKNOWN and must not be converted to zero or fabricated values.',
      'Model output cannot expand account mandates, trading allowlists, risk ceilings or spending authority.',
      'Any future order must revalidate live broker cash, holdings, an execution-authoritative quote and deterministic risk immediately before submission.',
    ],
  };

  // Keep the model packet compact. The full event ledger and raw source
  // snapshots stay stored server-side; OpenAI/Claude receive decision-relevant
  // summaries plus an explicit provenance envelope describing freshness and
  // snapshot lineage.
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

  return { ctx, signals, capital, plan, digest, deterministicBrief, eventIntelligence, dataProvenance };
}

export type PreparedAnalysis = Awaited<ReturnType<typeof prepareAnalysis>>;

export function agentRequestFor(question: string, prepared: PreparedAnalysis): AgentRequest {
  return {
    question,
    digest: prepared.digest,
    capital: prepared.capital,
    config: prepared.ctx.config,
    eventIntelligence: prepared.eventIntelligence,
    dataProvenance: prepared.dataProvenance,
    deterministicBrief: prepared.deterministicBrief,
  };
}

export async function finalizePreparedAnalysis(
  question: string,
  prepared: PreparedAnalysis,
  agent: AgentResult,
  modelInputAsOf = prepared.ctx.snapshot.asOf,
  modelDataProvenance: ModelDataProvenance = prepared.dataProvenance,
  modelInputFingerprint: string | null = null,
) {
  const { ctx, capital, plan, digest, dataProvenance: riskCheckDataProvenance } = prepared;
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
    // This digest reflects the deterministic state used for the final risk
    // decision. Async model-input lineage is stored separately below.
    portfolioSnapshot: digest,
    deterministicOutcome: {
      plan,
      riskDecision,
      baselineDecision,
      modelInputAsOf,
      riskSnapshotAsOf: ctx.snapshot.asOf,
      modelInputFingerprint,
      modelDataProvenance,
      riskCheckDataProvenance,
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
      modelInputFingerprint,
      modelDataReadMode: modelDataProvenance.preparation.readMode,
      riskCheckDataReadMode: riskCheckDataProvenance.preparation.readMode,
      modelPortfolioPreparedAt: modelDataProvenance.portfolio.preparedAt,
      riskPortfolioPreparedAt: riskCheckDataProvenance.portfolio.preparedAt,
      modelPortfolioFreshness: modelDataProvenance.portfolio.freshness,
      riskPortfolioFreshness: riskCheckDataProvenance.portfolio.freshness,
      modelMarketFreshness: modelDataProvenance.market.freshness,
      riskMarketFreshness: riskCheckDataProvenance.market.freshness,
      modelIntelligenceFreshness: modelDataProvenance.intelligence.freshness,
      riskIntelligenceFreshness: riskCheckDataProvenance.intelligence.freshness,
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
    riskSnapshotAsOf: ctx.snapshot.asOf,
    modelInputFingerprint,
    containsMockData: ctx.snapshot.containsMockData,
    sourceNotes: ctx.snapshot.sourceNotes,
    // Backward-compatible alias for the state used to validate the result.
    dataProvenance: riskCheckDataProvenance,
    modelDataProvenance,
    riskCheckDataProvenance,
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
