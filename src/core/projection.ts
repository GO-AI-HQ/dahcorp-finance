import { MONTHS_PER_YEAR, clamp, safeDiv } from './math.js';
import { addMonths } from './dates.js';

/**
 * Contribution / time-to-goal engine.
 *
 * A month-by-month simulation rather than a closed-form formula, because the
 * real mechanics are lumpy: a lump sum lands in one month, distributions are
 * partly reinvested and partly withdrawn, and the bifurcation rule diverts
 * cash flow once the income target is crossed.
 *
 * Nothing is annualised away. Every projected month is produced by the same
 * arithmetic, so a reader can audit any row.
 */
export interface ProjectionInputs {
  /** Capital already producing distributions. */
  startingIncomeCapital: number;
  /** Recurring external contribution per month. */
  monthlyContribution: number;
  /** One-time contribution amount. */
  lumpSum: number;
  /** Month index (0 = immediately) at which the lump sum is added. */
  lumpSumMonth: number;
  /** Modeled annual distribution rate as a fraction (e.g. 0.38). */
  annualDistributionRate: number;
  /** Share of received distributions reinvested (0-1). */
  dripRate: number;
  /** Target monthly distribution income. */
  targetMonthlyIncome: number;
  /** Simulation horizon. */
  horizonMonths: number;
  /** Current share price, used to project share count. Optional. */
  sharePrice?: number;
  /**
   * Annual drift applied to the distribution rate, as a fraction of itself.
   * Negative models the realistic case of a decaying option-income payout.
   */
  annualRateDrift?: number;
  /**
   * Annual NAV drift as a fraction. Negative models NAV erosion, which reduces
   * capital even while cash keeps arriving.
   */
  annualNavDrift?: number;
  /** Once target income is reached, share of distributions kept in the engine. */
  bifurcationReinvestShare?: number;
  /** ISO start date for month labels. */
  startDate?: string;
}

export interface ProjectionMonth {
  month: number;
  date: string | null;
  /** Capital in the income engine at the end of the month. */
  incomeCapital: number;
  /** Distribution cash produced during the month. */
  distribution: number;
  /** Portion reinvested. */
  reinvested: number;
  /** Portion taken out of the engine (withdrawn or redirected to growth). */
  diverted: number;
  /** External money added this month. */
  contributed: number;
  /** Modeled forward monthly income at end of month. */
  monthlyIncome: number;
  /** Projected share count if a share price was supplied. */
  shares: number | null;
  cumulativeContributions: number;
  cumulativeDistributions: number;
  cumulativeReinvested: number;
  cumulativeDiverted: number;
  /** Capital redirected to the growth engine after bifurcation. */
  growthCapital: number;
  effectiveAnnualRate: number;
}

export interface ProjectionResult {
  months: ProjectionMonth[];
  /** First month index where modeled monthly income ≥ target. */
  monthsToTarget: number | null;
  targetDate: string | null;
  /** Capital required at the modeled rate to sustain the target. */
  requiredCapital: number | null;
  finalMonthlyIncome: number;
  finalIncomeCapital: number;
  finalGrowthCapital: number;
  totalContributed: number;
  totalDistributions: number;
  totalReinvested: number;
  /** Share of ending capital that came from distributions rather than deposits. */
  selfFundedShare: number;
  reachedTarget: boolean;
  warnings: string[];
}

const MAX_HORIZON = 600;

export function projectIncome(inputs: ProjectionInputs): ProjectionResult {
  const horizon = clamp(Math.round(inputs.horizonMonths || 0), 1, MAX_HORIZON);
  const drip = clamp(inputs.dripRate, 0, 1);
  const bifurcationShare = clamp(inputs.bifurcationReinvestShare ?? 1, 0, 1);
  const rateDriftPerMonth = (inputs.annualRateDrift ?? 0) / MONTHS_PER_YEAR;
  const navDriftPerMonth = (inputs.annualNavDrift ?? 0) / MONTHS_PER_YEAR;

  const warnings: string[] = [];
  if (!(inputs.annualDistributionRate > 0)) {
    warnings.push('No positive distribution rate supplied — projection cannot model income growth.');
  }
  if (inputs.annualDistributionRate > 0.6) {
    warnings.push('Modeled distribution rate above 60% annualised. Treat as an upper bound, not an expectation.');
  }
  if (drip < 1) {
    warnings.push(`${Math.round((1 - drip) * 100)}% of distributions are modeled as withdrawn, which slows compounding.`);
  }

  let capital = Math.max(0, inputs.startingIncomeCapital);
  let growthCapital = 0;
  let sharePrice = inputs.sharePrice && inputs.sharePrice > 0 ? inputs.sharePrice : null;
  let annualRate = Math.max(0, inputs.annualDistributionRate);

  let cumulativeContributions = 0;
  let cumulativeDistributions = 0;
  let cumulativeReinvested = 0;
  let cumulativeDiverted = 0;
  let monthsToTarget: number | null = null;

  const months: ProjectionMonth[] = [];

  for (let m = 1; m <= horizon; m++) {
    // NAV drift is applied to existing capital before this month's cash flows.
    if (navDriftPerMonth !== 0) capital *= 1 + navDriftPerMonth;
    if (sharePrice != null && navDriftPerMonth !== 0) sharePrice *= 1 + navDriftPerMonth;

    const contributed =
      Math.max(0, inputs.monthlyContribution) + (m === Math.max(1, inputs.lumpSumMonth) ? Math.max(0, inputs.lumpSum) : 0);
    capital += contributed;
    cumulativeContributions += contributed;

    const monthlyRate = annualRate / MONTHS_PER_YEAR;
    const distribution = capital * monthlyRate;
    cumulativeDistributions += distribution;

    // Before the target is reached the DRIP rate governs. After it, the
    // configured bifurcation split governs how much stays in the engine.
    const currentIncome = distribution;
    const reachedNow = inputs.targetMonthlyIncome > 0 && currentIncome >= inputs.targetMonthlyIncome;
    const reinvestShare = reachedNow ? drip * bifurcationShare : drip;
    const reinvested = distribution * reinvestShare;
    const diverted = distribution - reinvested;

    capital += reinvested;
    growthCapital += reachedNow ? diverted : 0;
    cumulativeReinvested += reinvested;
    cumulativeDiverted += diverted;

    const monthlyIncome = (capital * annualRate) / MONTHS_PER_YEAR;
    if (monthsToTarget == null && inputs.targetMonthlyIncome > 0 && monthlyIncome >= inputs.targetMonthlyIncome) {
      monthsToTarget = m;
    }

    months.push({
      month: m,
      date: inputs.startDate ? addMonths(inputs.startDate, m) : null,
      incomeCapital: capital,
      distribution,
      reinvested,
      diverted,
      contributed,
      monthlyIncome,
      shares: sharePrice != null ? capital / sharePrice : null,
      cumulativeContributions,
      cumulativeDistributions,
      cumulativeReinvested,
      cumulativeDiverted,
      growthCapital,
      effectiveAnnualRate: annualRate,
    });

    if (rateDriftPerMonth !== 0) annualRate = Math.max(0, annualRate * (1 + rateDriftPerMonth));
  }

  const last = months.at(-1);
  const requiredCapital =
    annualRate > 0 && inputs.targetMonthlyIncome > 0
      ? (inputs.targetMonthlyIncome * MONTHS_PER_YEAR) / Math.max(0.0001, inputs.annualDistributionRate)
      : null;

  if (monthsToTarget == null) {
    warnings.push(`Target of $${inputs.targetMonthlyIncome.toFixed(0)}/mo is not reached within ${horizon} months under these assumptions.`);
  }

  const endingCapital = last?.incomeCapital ?? capital;
  const externalTotal = inputs.startingIncomeCapital + cumulativeContributions;

  return {
    months,
    monthsToTarget,
    targetDate: monthsToTarget != null && inputs.startDate ? addMonths(inputs.startDate, monthsToTarget) : null,
    requiredCapital,
    finalMonthlyIncome: last?.monthlyIncome ?? 0,
    finalIncomeCapital: endingCapital,
    finalGrowthCapital: last?.growthCapital ?? 0,
    totalContributed: cumulativeContributions,
    totalDistributions: cumulativeDistributions,
    totalReinvested: cumulativeReinvested,
    selfFundedShare: safeDiv(Math.max(0, endingCapital + (last?.growthCapital ?? 0) - externalTotal), endingCapital + (last?.growthCapital ?? 0)),
    reachedTarget: monthsToTarget != null,
    warnings,
  };
}

/**
 * Solve for the recurring monthly contribution that reaches the target income
 * by a deadline. Bisection on the simulation — no closed form exists once NAV
 * drift, rate drift and partial DRIP are in play.
 *
 * Answers "how much must I invest monthly to reach $500/month in 12 months?"
 * without ever hard-coding an answer.
 */
export function solveMonthlyContribution(
  base: Omit<ProjectionInputs, 'monthlyContribution' | 'horizonMonths'>,
  deadlineMonths: number,
  bounds: { min?: number; max?: number; tolerance?: number } = {},
): { monthlyContribution: number | null; achieved: boolean; projection: ProjectionResult | null } {
  const min = bounds.min ?? 0;
  const max = bounds.max ?? 100_000;
  const tolerance = bounds.tolerance ?? 1;

  const run = (contribution: number) =>
    projectIncome({ ...base, monthlyContribution: contribution, horizonMonths: deadlineMonths });

  const atMin = run(min);
  if (atMin.reachedTarget) return { monthlyContribution: min, achieved: true, projection: atMin };

  const atMax = run(max);
  if (!atMax.reachedTarget) return { monthlyContribution: null, achieved: false, projection: atMax };

  let lo = min;
  let hi = max;
  let best = atMax;
  // 40 iterations resolves a $0-100k range to well under a cent.
  for (let i = 0; i < 40 && hi - lo > tolerance; i++) {
    const mid = (lo + hi) / 2;
    const result = run(mid);
    if (result.reachedTarget) {
      hi = mid;
      best = result;
    } else {
      lo = mid;
    }
  }
  return { monthlyContribution: hi, achieved: true, projection: best };
}

/** Contribution required for each of a set of deadlines (12 / 18 / 24 months). */
export function contributionSchedule(
  base: Omit<ProjectionInputs, 'monthlyContribution' | 'horizonMonths'>,
  deadlines: number[],
): { deadlineMonths: number; monthlyContribution: number | null; totalExternal: number | null }[] {
  return deadlines.map((deadlineMonths) => {
    const solved = solveMonthlyContribution(base, deadlineMonths);
    return {
      deadlineMonths,
      monthlyContribution: solved.monthlyContribution,
      totalExternal:
        solved.monthlyContribution != null ? solved.monthlyContribution * deadlineMonths + base.lumpSum : null,
    };
  });
}

export type ScenarioName = 'conservative' | 'base' | 'aggressive';

export interface ScenarioSet {
  name: ScenarioName;
  label: string;
  description: string;
  annualDistributionRate: number;
  annualNavDrift: number;
  annualRateDrift: number;
  projection: ProjectionResult;
}

/**
 * Three-scenario band. The aggressive case uses the current (highest) observed
 * distribution rate and assumes no decay — it is a ceiling, never a forecast.
 */
export function buildScenarios(
  base: ProjectionInputs,
  rates: { conservative: number; base: number; aggressive: number },
): ScenarioSet[] {
  const specs: { name: ScenarioName; label: string; description: string; rate: number; navDrift: number; rateDrift: number }[] = [
    {
      name: 'conservative',
      label: 'Conservative',
      description: 'Haircut distribution rate, continued NAV erosion and a decaying payout.',
      rate: rates.conservative,
      navDrift: -0.08,
      rateDrift: -0.12,
    },
    {
      name: 'base',
      label: 'Base',
      description: 'Trailing-average distribution rate with mild NAV drift and mild payout decay.',
      rate: rates.base,
      navDrift: -0.03,
      rateDrift: -0.05,
    },
    {
      name: 'aggressive',
      label: 'Aggressive',
      description: 'Current distribution rate held flat with no NAV erosion. An upper bound, not a projection.',
      rate: rates.aggressive,
      navDrift: 0,
      rateDrift: 0,
    },
  ];

  return specs.map((spec) => ({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    annualDistributionRate: spec.rate,
    annualNavDrift: spec.navDrift,
    annualRateDrift: spec.rateDrift,
    projection: projectIncome({
      ...base,
      annualDistributionRate: spec.rate,
      annualNavDrift: spec.navDrift,
      annualRateDrift: spec.rateDrift,
    }),
  }));
}
