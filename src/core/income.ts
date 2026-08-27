import type { DistributionEvent, IncomeEvent, PortfolioSnapshot } from './types.js';
import type { DistributionBasis, StrategyConfig } from './config.js';
import { activeMilestone } from './config.js';
import { MONTHS_PER_YEAR, WEEKS_PER_MONTH, safeDiv, sum } from './math.js';
import { withinTrailingDays } from './dates.js';
import {
  annualPerShare,
  applyHaircut,
  computeDistributionStats,
  monthlyPerShare,
  priceChangeOverDays,
  totalReturnOverDays,
  weeklyEquivalentPerShare,
  type DistributionStats,
} from './distributions.js';
import { computeSelfBuy, computeSelfFundingMilestone, type SelfBuyResult, type SelfFundingMilestone } from './selfBuy.js';
import type { PortfolioAnalysis, PositionView } from './portfolio.js';
import type { AccountType, CalculationScope, VerificationStatus } from './types.js';
import {
  accountInScope,
  CALCULATION_SCOPE_LABELS,
  incomePositionInScope,
} from './scope.js';
import { getInstrumentOrFallback } from './universe.js';

/** Per-position income analytics for the Income Engine view. */
export interface IncomePositionView {
  symbol: string;
  name: string;
  accountName: string;
  broker: string;
  shares: number;
  price: number;
  marketValue: number;
  costBasisTotal: number;
  unrealizedPL: number;
  unrealizedPLPct: number | null;
  stats: DistributionStats;
  /** Per-share distribution on the active basis. */
  weeklyPerShare: number | null;
  monthlyPerShare: number | null;
  annualPerShare: number | null;
  /** Position-level dollars. */
  weeklyIncome: number;
  monthlyIncome: number;
  annualIncome: number;
  /** Modeled forward distribution rate against price. Not a total return. */
  distributionRate: number | null;
  returnOfCapitalPct: number | null;
  navChange26w: number | null;
  totalReturn52w: number | null;
  selfBuy: SelfBuyResult;
  accountType: AccountType;
  /** SIMULATED / UNVERIFIED positions are shown but never drive a decision. */
  verification: VerificationStatus;
  verified: boolean;
  /** Warnings that must be shown alongside the income figures. */
  flags: string[];
}

export interface IncomeSummary {
  asOf: string;
  /** The slice of capital every figure below is measured over. */
  scope: CalculationScope;
  scopeLabel: string;
  basis: DistributionBasis;
  haircut: number;
  /** Cash actually received — audited, not modeled. */
  received7d: number;
  received30d: number;
  received90d: number;
  receivedLifetime: number;
  /** Modeled forward income from current positions on the active basis. */
  forwardWeeklyIncome: number;
  forwardMonthlyIncome: number;
  forwardAnnualIncome: number;
  /** The same figures after the conservative haircut. */
  conservativeMonthlyIncome: number;
  /** Capital deployed in income-producing positions. */
  incomeEngineCapital: number;
  /** Blended modeled distribution rate across the income sleeve. */
  blendedDistributionRate: number | null;
  blendedConservativeRate: number | null;
  positions: IncomePositionView[];
  /** Income-producing positions left out by the active scope, with reasons. */
  excluded: {
    symbol: string;
    accountName: string;
    accountType: AccountType;
    marketValue: number;
    reason: string;
  }[];
  /** Capital inside the scope that is not yet brokerage-verified. */
  simulatedCapital: number;
  containsSimulated: boolean;
  selfFundingMilestone: SelfFundingMilestone;
  /** Estimated ROC-adjusted income: the part that is not the investor's own money. */
  estimatedEconomicIncomeMonthly: number | null;
  flags: string[];
}

function positionFlags(view: {
  stats: DistributionStats;
  navChange26w: number | null;
  totalReturn52w: number | null;
}): string[] {
  const flags: string[] = [];
  if (view.stats.thinHistory) flags.push('Thin distribution history');
  if (view.stats.trend < -0.02) flags.push('Distributions trending down');
  if (view.stats.stability < 0.5) flags.push('Unstable distributions');
  if ((view.stats.returnOfCapitalPct ?? 0) > 0.5) flags.push('Majority return of capital');
  if ((view.navChange26w ?? 0) < -0.1) flags.push('NAV erosion over 26w');
  if ((view.totalReturn52w ?? 0) < 0) flags.push('Negative 52w total return');
  return flags;
}

/**
 * Income-producing positions are those whose sleeve pays cash by design.
 *
 * Scope-blind, and kept for callers that want the whole-portfolio notion. The
 * income summary uses `incomePositionInScope` instead, because a REIT sleeve
 * held in a Roth IRA pays a fraction of the engine's rate and would otherwise
 * drag the blended distribution rate — and therefore inflate the capital
 * required to reach the taxable $500/month objective.
 */
export function isIncomeProducing(position: PositionView): boolean {
  return position.sleeve === 'income_engine' || position.sleeve === 'reit_dividend';
}

export function buildIncomeSummary(
  snapshot: PortfolioSnapshot,
  analysis: PortfolioAnalysis,
  config: StrategyConfig,
  /** Overrides the configured scope — used by derived per-scope views. */
  scopeOverride?: CalculationScope,
): IncomeSummary {
  const asOf = snapshot.asOf;
  const basis = config.distributionBasis;
  const scope = scopeOverride ?? config.calculationScope;

  const incomeCandidates = analysis.positions.filter(isIncomeProducing);
  const incomePositions = incomeCandidates.filter((p) => incomePositionInScope(p, scope));
  const excluded = incomeCandidates
    .filter((p) => !incomePositionInScope(p, scope))
    .map((p) => ({
      symbol: p.symbol,
      accountName: p.account.name,
      accountType: p.accountType,
      marketValue: p.marketValue,
      reason:
        p.accountType === 'taxable'
          ? `${p.sleeve.replace(/_/g, ' ')} sleeve is outside the ${CALCULATION_SCOPE_LABELS[scope]} scope.`
          : `${p.account.name} is outside the ${CALCULATION_SCOPE_LABELS[scope]} scope.`,
    }));

  const positions: IncomePositionView[] = incomePositions.map((p) => {
    const stats = computeDistributionStats(p.symbol, snapshot.distributions, asOf);
    const weekly = weeklyEquivalentPerShare(stats, basis);
    const monthly = monthlyPerShare(stats, basis);
    const annual = annualPerShare(stats, basis);
    const bars = snapshot.priceHistory[p.symbol] ?? [];
    const symbolDistributions = snapshot.distributions.filter((d) => d.symbol === p.symbol);
    const navChange26w = priceChangeOverDays(bars, asOf, 182);
    const tr = totalReturnOverDays(bars, symbolDistributions, asOf, 364);
    const selfBuy = computeSelfBuy({ shares: p.shares, price: p.price, weeklyPerShare: weekly, monthlyPerShare: monthly });

    return {
      symbol: p.symbol,
      name: p.name,
      accountName: p.account.name,
      broker: p.account.broker,
      shares: p.shares,
      price: p.price,
      marketValue: p.marketValue,
      costBasisTotal: p.costBasisTotal,
      unrealizedPL: p.unrealizedPL,
      unrealizedPLPct: p.unrealizedPLPct,
      stats,
      weeklyPerShare: weekly,
      monthlyPerShare: monthly,
      annualPerShare: annual,
      weeklyIncome: selfBuy.weeklyDistribution,
      monthlyIncome: selfBuy.monthlyDistribution,
      annualIncome: selfBuy.annualDistribution,
      distributionRate: annual != null && p.price > 0 ? annual / p.price : null,
      returnOfCapitalPct: stats.returnOfCapitalPct,
      navChange26w,
      totalReturn52w: tr?.totalReturn ?? null,
      selfBuy,
      accountType: p.accountType,
      verification: p.verification,
      verified: p.verified,
      flags: positionFlags({ stats, navChange26w, totalReturn52w: tr?.totalReturn ?? null }),
    };
  });

  // Received cash is scoped the same way as modeled income: a Roth dividend is
  // real money, but it is not income the taxable engine produced.
  const scopedAccountIds = new Set(
    snapshot.accounts.filter((a) => accountInScope(a, scope)).map((a) => a.id),
  );
  const eventInScope = (accountId: string, symbol: string) => {
    if (!scopedAccountIds.has(accountId)) return false;
    const sleeve = getInstrumentOrFallback(symbol).sleeve;
    return incomePositionInScope({ accountType: 'taxable', sleeve }, scope);
  };
  const scopedIncomeEvents = snapshot.incomeEvents.filter((e) => eventInScope(e.accountId, e.symbol));
  const received = (days: number) =>
    sum(scopedIncomeEvents.filter((e) => withinTrailingDays(e.payDate, asOf, days)).map((e) => e.grossAmount));

  const forwardWeeklyIncome = sum(positions.map((p) => p.weeklyIncome));
  const forwardMonthlyIncome = sum(positions.map((p) => p.monthlyIncome));
  const forwardAnnualIncome = sum(positions.map((p) => p.annualIncome));
  const incomeEngineCapital = sum(positions.map((p) => p.marketValue));

  const blendedDistributionRate = incomeEngineCapital > 0 ? forwardAnnualIncome / incomeEngineCapital : null;
  const conservativeMonthlyIncome = applyHaircut(forwardMonthlyIncome, config.conservativeHaircut) ?? 0;

  // Economic income excludes the estimated return-of-capital portion. Where ROC
  // is unreported the position is excluded rather than assumed to be clean.
  const rocReported = positions.filter((p) => p.returnOfCapitalPct != null);
  const estimatedEconomicIncomeMonthly = rocReported.length
    ? sum(rocReported.map((p) => p.monthlyIncome * (1 - (p.returnOfCapitalPct ?? 0))))
    : null;

  const milestonePositions = positions
    .filter((p) => Object.keys(config.incomeAllocationTargets).includes(p.symbol) || p.stats.frequency === 'weekly')
    .map((p) => ({ symbol: p.symbol, shares: p.shares, price: p.price, selfBuy: p.selfBuy }));

  const simulatedCapital = sum(positions.filter((p) => !p.verified).map((p) => p.marketValue));
  const containsSimulated = simulatedCapital > 0;

  const flags: string[] = [];
  if (snapshot.containsMockData) flags.push('Snapshot contains mock fixture data.');
  if (containsSimulated) {
    flags.push(
      'Some in-scope capital is SIMULATED and cannot drive live decisions until a brokerage adapter verifies it.',
    );
  }
  if (excluded.length) {
    flags.push(
      `${excluded.length} income-producing position${excluded.length === 1 ? '' : 's'} excluded by the ${CALCULATION_SCOPE_LABELS[scope]} scope: ${excluded.map((e) => e.symbol).join(', ')}.`,
    );
  }
  if (positions.some((p) => p.stats.thinHistory)) flags.push('At least one position has thin distribution history.');
  if (estimatedEconomicIncomeMonthly != null && estimatedEconomicIncomeMonthly < forwardMonthlyIncome * 0.6) {
    flags.push('A large share of modeled income is estimated return of capital, not economic income.');
  }

  return {
    asOf,
    scope,
    scopeLabel: CALCULATION_SCOPE_LABELS[scope],
    basis,
    haircut: config.conservativeHaircut,
    received7d: received(7),
    received30d: received(30),
    received90d: received(90),
    receivedLifetime: sum(scopedIncomeEvents.map((e) => e.grossAmount)),
    forwardWeeklyIncome,
    forwardMonthlyIncome,
    forwardAnnualIncome,
    conservativeMonthlyIncome,
    incomeEngineCapital,
    blendedDistributionRate,
    blendedConservativeRate: blendedDistributionRate != null
      ? applyHaircut(blendedDistributionRate, config.conservativeHaircut)
      : null,
    positions,
    excluded,
    simulatedCapital,
    containsSimulated,
    selfFundingMilestone: computeSelfFundingMilestone(milestonePositions),
    estimatedEconomicIncomeMonthly,
    flags,
  };
}

/**
 * Capital required to produce a target monthly income at a modeled rate.
 *
 *   required_capital = desired_monthly_income × 12 / modeled_distribution_rate
 *
 * The earlier "$15,800 → ~$500/month" figure is one output of this function at
 * one assumed rate, not a fixed requirement.
 */
export function requiredCapitalForIncome(desiredMonthlyIncome: number, modeledAnnualRate: number): number | null {
  if (!(modeledAnnualRate > 0)) return null;
  return (desiredMonthlyIncome * MONTHS_PER_YEAR) / modeledAnnualRate;
}

export interface MilestoneProgress {
  id: string;
  label: string;
  targetMonthlyIncome: number;
  currentMonthlyIncome: number;
  progress: number;
  reached: boolean;
  requiredCapital: number | null;
  capitalGap: number | null;
  /** Capital required under the conservative rate. */
  requiredCapitalConservative: number | null;
}

export function milestoneProgress(income: IncomeSummary, config: StrategyConfig): MilestoneProgress[] {
  const rate = income.blendedDistributionRate;
  const conservativeRate = income.blendedConservativeRate;
  return config.milestones.map((m) => {
    const requiredCapital = rate != null ? requiredCapitalForIncome(m.monthlyIncome, rate) : null;
    return {
      id: m.id,
      label: m.label,
      targetMonthlyIncome: m.monthlyIncome,
      currentMonthlyIncome: income.forwardMonthlyIncome,
      progress: safeDiv(income.forwardMonthlyIncome, m.monthlyIncome),
      reached: income.forwardMonthlyIncome >= m.monthlyIncome,
      requiredCapital,
      capitalGap: requiredCapital != null ? Math.max(0, requiredCapital - income.incomeEngineCapital) : null,
      requiredCapitalConservative:
        conservativeRate != null ? requiredCapitalForIncome(m.monthlyIncome, conservativeRate) : null,
    };
  });
}

/**
 * Income Velocity — how fast monthly income is currently increasing, in
 * dollars of monthly income added per month, decomposed by source.
 */
export interface IncomeVelocity {
  /** New monthly income per month from external contributions. */
  contributionDriven: number;
  /** New monthly income per month from reinvested distributions. */
  dripDriven: number;
  /** Change attributable to distribution-rate and price movement. */
  marketDriven: number;
  total: number;
  /** Months to the active milestone at the current velocity (no compounding). */
  linearMonthsToMilestone: number | null;
  notes: string[];
}

export function computeIncomeVelocity(args: {
  income: IncomeSummary;
  config: StrategyConfig;
  /** Modeled monthly income measured one period ago, if available. */
  priorMonthlyIncome?: number | null;
  /** Months between the prior measurement and now. */
  priorPeriodMonths?: number;
}): IncomeVelocity {
  const { income, config } = args;
  const rate = income.blendedDistributionRate ?? 0;
  const monthlyRate = rate / MONTHS_PER_YEAR;

  const contributionDriven = config.monthlyContribution * monthlyRate;
  const dripDriven = income.forwardMonthlyIncome * config.dripRate * monthlyRate;

  let marketDriven = 0;
  const notes: string[] = [];
  if (args.priorMonthlyIncome != null && args.priorPeriodMonths && args.priorPeriodMonths > 0) {
    const observed = (income.forwardMonthlyIncome - args.priorMonthlyIncome) / args.priorPeriodMonths;
    marketDriven = observed - contributionDriven - dripDriven;
    notes.push('Market component is the residual between observed and modeled income growth.');
  } else {
    notes.push('No prior income snapshot yet — market/distribution drift is shown as $0 until history accumulates.');
  }

  const total = contributionDriven + dripDriven + marketDriven;
  const target = activeMilestone(config).monthlyIncome;
  const gap = target - income.forwardMonthlyIncome;

  return {
    contributionDriven,
    dripDriven,
    marketDriven,
    total,
    linearMonthsToMilestone: gap <= 0 ? 0 : total > 0 ? gap / total : null,
    notes,
  };
}

/** Distributions received, bucketed by month, for the income history chart. */
export function monthlyReceivedIncome(events: IncomeEvent[]): { month: string; amount: number }[] {
  const buckets = new Map<string, number>();
  for (const e of events) {
    const key = e.payDate.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + e.grossAmount);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount }));
}

/** Weekly distribution cash per share, for the per-position sparkline. */
export function weeklyDistributionSeries(
  events: DistributionEvent[],
  symbol: string,
  limit = 26,
): { date: string; amount: number }[] {
  return events
    .filter((e) => e.symbol.toUpperCase() === symbol.toUpperCase())
    .slice()
    .sort((a, b) => a.payDate.localeCompare(b.payDate))
    .slice(-limit)
    .map((e) => ({ date: e.payDate, amount: e.amountPerShare }));
}

export { WEEKS_PER_MONTH };
