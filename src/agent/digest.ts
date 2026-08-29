/**
 * The digest handed to the Treasury Strategist.
 *
 * Deliberately narrow: derived figures only, no credentials, no account
 * numbers, no personal identifiers. The model sees the same decision evidence
 * the investor sees, plus deterministic limits it cannot override.
 */
import type { AnalysisContext } from '../services/analysis.js';
import { activeMilestone, strategyLevelFor } from '../core/config.js';
import { CALCULATION_SCOPE_LABELS } from '../core/scope.js';
import type { AllocationPlan, OpportunityRow } from '../strategy/allocation.js';
import type { SemiconductorEngine } from '../core/semiconductor.js';
import { round } from '../core/math.js';

export interface AgentDigest {
  asOf: string;
  dataQuality: string;
  containsMockData: boolean;
  policy: {
    calculationScope: string;
    calculationScopeLabel: string;
    externalLiquidityTarget: number;
    externalLiquidityCurrent: number;
    externalLiquidityGap: number;
    externalReserveUnderfunded: boolean;
    brokerCash: number;
    deployableBrokerCash: number;
    maxLeveragedSleevePct: number;
    currentLeveragedPct: number;
    maxSinglePositionPct: number;
    maxOrderNotional: number;
    executionPhase: number;
    distributionBasis: string;
    conservativeHaircut: number;
    allocationEligibleAccounts: { id: string; name: string; cash: number }[];
    excludedAccounts: { id: string; name: string; reason: string }[];
  };
  totals: { portfolioValue: number; cash: number; invested: number; unrealizedPL: number | null; costBasisComplete: boolean };
  milestone: { label: string; monthlyIncome: number; progressPct: number; strategyLevel: string };
  income: {
    scope: string;
    scopeLabel: string;
    incomeEngineCapital: number;
    excludedByScope: { symbol: string; accountName: string; marketValue: number; reason: string }[];
    forwardMonthlyIncome: number;
    conservativeMonthlyIncome: number;
    received30d: number;
    blendedDistributionRate: number | null;
    estimatedEconomicIncomeMonthly: number | null;
    flags: string[];
  };
  positions: {
    symbol: string;
    sleeve: string;
    accountId: string;
    shares: number;
    price: number;
    marketValue: number;
    weight: number;
    costBasisKnown: boolean;
    unrealizedPLPct: number | null;
    accountType: string;
    verification: string;
    /** Only CONFIRMED positions may drive ownership/exposure decisions. */
    liveDecisionEligible: boolean;
    inCalculationScope: boolean;
    monthlySelfBuyRatio?: number | null;
    sharesNeededToSelfFund?: number | null;
    distributionStability?: number;
    returnOfCapitalPct?: number | null;
    navChange26w?: number | null;
    totalReturn52w?: number | null;
  }[];
  sleeves: { sleeve: string; weight: number; ceiling: number | null; overCeiling: boolean }[];
  opportunities: {
    symbol: string;
    score: number;
    verdict: string;
    reason: string;
    held: boolean;
    warnings: string[];
  }[];
  semiconductor: {
    cores: { symbol: string; held: boolean; trend: string; dipLevelReached: number | null }[];
    tactical: {
      symbol: string;
      leverage: number;
      held: boolean;
      trend: string;
      harvestArmed: boolean;
      harvestArmedLive: boolean;
      harvestVerification: string;
      harvestRule: string;
      riskAction: string;
      volatilityDrag: number | null;
    }[];
    leveragedPct: number;
    leveragedHeadroom: number;
  };
  deterministicBaseline: {
    availableCapital: number;
    legs: { symbol: string; amount: number; accountId: string; reason: string }[];
    reserved: number;
    reservedReason: string | null;
    reasoning: string[];
    constraints: string[];
  };
  drag: { severity: string; title: string; detail: string }[];
}

export function buildAgentDigest(args: {
  ctx: AnalysisContext;
  plan: AllocationPlan;
  opportunities: OpportunityRow[];
  semis: SemiconductorEngine;
  drag: { severity: string; title: string; detail: string }[];
  capital: number;
}): AgentDigest {
  const { ctx, plan, opportunities, semis, drag, capital } = args;
  const { snapshot, analysis, income, config } = ctx;
  const milestone = activeMilestone(config);
  const level = strategyLevelFor(income.forwardMonthlyIncome);
  const scopedHoldingIds = new Set(analysis.scoped.positions.map((p) => p.holding.id));
  const costBasisComplete = analysis.positions.every((p) => p.holding.costBasisKnown !== false);

  return {
    asOf: snapshot.asOf,
    dataQuality: snapshot.dataQuality,
    containsMockData: snapshot.containsMockData,
    policy: {
      calculationScope: config.calculationScope,
      calculationScopeLabel: CALCULATION_SCOPE_LABELS[config.calculationScope],
      externalLiquidityTarget: round(analysis.totals.externalLiquidityTarget, 2),
      externalLiquidityCurrent: round(analysis.totals.externalLiquidityCurrent, 2),
      externalLiquidityGap: round(analysis.totals.externalLiquidityGap, 2),
      externalReserveUnderfunded: analysis.totals.externalReserveUnderfunded,
      brokerCash: round(analysis.totals.brokerCash, 2),
      deployableBrokerCash: round(capital, 2),
      maxLeveragedSleevePct: config.maxLeveragedSleevePct,
      currentLeveragedPct: round(analysis.leveragedPct, 4),
      maxSinglePositionPct: config.maxSinglePositionPct,
      maxOrderNotional: config.maxOrderNotional,
      executionPhase: config.executionPhase,
      distributionBasis: config.distributionBasis,
      conservativeHaircut: config.conservativeHaircut,
      allocationEligibleAccounts: analysis.accounts
        .filter((a) => a.account.allocationEligible)
        .map((a) => ({ id: a.account.id, name: a.account.name, cash: round(a.cash, 2) })),
      excludedAccounts: analysis.accounts
        .filter((a) => !a.account.allocationEligible)
        .map((a) => ({
          id: a.account.id,
          name: a.account.name,
          reason: 'Visible for household awareness but not authorized for this strategy to allocate.',
        })),
    },
    totals: {
      portfolioValue: round(analysis.totals.totalValue, 2),
      cash: round(analysis.totals.totalCash, 2),
      invested: round(analysis.totals.totalInvested, 2),
      unrealizedPL: costBasisComplete ? round(analysis.totals.unrealizedPL, 2) : null,
      costBasisComplete,
    },
    milestone: {
      label: milestone.label,
      monthlyIncome: milestone.monthlyIncome,
      progressPct: round((income.forwardMonthlyIncome / milestone.monthlyIncome) * 100, 1),
      strategyLevel: `${level.level} — ${level.name}`,
    },
    income: {
      scope: income.scope,
      scopeLabel: income.scopeLabel,
      incomeEngineCapital: round(analysis.scoped.incomeEngineCapital, 2),
      excludedByScope: income.excluded.map((e) => ({
        symbol: e.symbol,
        accountName: e.accountName,
        marketValue: round(e.marketValue, 2),
        reason: e.reason,
      })),
      forwardMonthlyIncome: round(income.forwardMonthlyIncome, 2),
      conservativeMonthlyIncome: round(income.conservativeMonthlyIncome, 2),
      received30d: round(income.received30d, 2),
      blendedDistributionRate: income.blendedDistributionRate,
      estimatedEconomicIncomeMonthly: income.estimatedEconomicIncomeMonthly,
      flags: income.flags,
    },
    positions: analysis.positions.map((p) => {
      const incomeView = income.positions.find((i) => i.symbol === p.symbol);
      const costBasisKnown = p.holding.costBasisKnown !== false;
      return {
        symbol: p.symbol,
        sleeve: p.sleeve,
        accountId: p.account.id,
        shares: round(p.shares, 4),
        price: round(p.price, 2),
        marketValue: round(p.marketValue, 2),
        weight: round(p.weight, 4),
        costBasisKnown,
        unrealizedPLPct: costBasisKnown ? p.unrealizedPLPct : null,
        accountType: p.accountType,
        verification: p.verification,
        liveDecisionEligible: p.verified,
        inCalculationScope: scopedHoldingIds.has(p.holding.id),
        monthlySelfBuyRatio: incomeView?.selfBuy.monthlySelfBuyRatio ?? null,
        sharesNeededToSelfFund: incomeView?.selfBuy.sharesRequiredForOnePerMonth ?? null,
        distributionStability: incomeView?.stats.stability,
        returnOfCapitalPct: incomeView?.stats.returnOfCapitalPct ?? null,
        navChange26w: incomeView?.navChange26w ?? null,
        totalReturn52w: incomeView?.totalReturn52w ?? null,
      };
    }),
    sleeves: analysis.sleeves.map((s) => ({
      sleeve: s.sleeve,
      weight: round(s.weight, 4),
      ceiling: s.ceiling,
      overCeiling: s.overCeiling,
    })),
    opportunities: opportunities.slice(0, 12).map((o) => ({
      symbol: o.symbol,
      score: round(o.efficiency.score, 1),
      verdict: o.verdict,
      reason: o.verdictReason,
      held: o.held,
      warnings: o.efficiency.warnings,
    })),
    semiconductor: {
      cores: semis.cores.map((c) => ({
        symbol: c.symbol,
        held: c.held,
        trend: c.trend.status,
        dipLevelReached: c.dip.levelReached,
      })),
      tactical: semis.tactical.map((t) => ({
        symbol: t.symbol,
        leverage: t.leverage,
        held: t.held,
        trend: t.trend.status,
        harvestArmed: t.harvest.armed,
        harvestArmedLive: t.harvest.armedLive,
        harvestVerification: t.harvest.verification,
        harvestRule: t.harvest.ruleOutcome,
        riskAction: t.riskReduction.recommendedAction,
        volatilityDrag: t.estimatedVolatilityDrag,
      })),
      leveragedPct: round(semis.exposure.leveragedPct, 4),
      leveragedHeadroom: round(semis.exposure.headroom, 2),
    },
    deterministicBaseline: {
      availableCapital: round(plan.availableCapital, 2),
      legs: plan.legs.map((l) => ({
        symbol: l.symbol,
        amount: round(l.amount, 2),
        accountId: l.accountId,
        reason: l.reason,
      })),
      reserved: round(plan.reserved, 2),
      reservedReason: plan.reservedReason,
      reasoning: plan.reasoning,
      constraints: plan.constraints,
    },
    drag,
  };
}
