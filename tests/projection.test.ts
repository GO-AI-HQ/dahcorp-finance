import { describe, expect, it } from 'vitest';
import type { ProjectionInputs } from '../src/core/projection.js';
import {
  buildScenarios,
  contributionSchedule,
  projectIncome,
  solveMonthlyContribution,
} from '../src/core/projection.js';
import { AS_OF } from './helpers.js';

/**
 * The contribution / time-to-goal engine. The plan's illustrative figures
 * (~$1,080 for 12 months, ~$650 for 18, ~$440 for 24) must be *solved*, so
 * these tests check the mechanics and the solver rather than any constant.
 */
const base: ProjectionInputs = {
  startingIncomeCapital: 10_000,
  monthlyContribution: 0,
  lumpSum: 0,
  lumpSumMonth: 0,
  annualDistributionRate: 0.12, // 1% a month keeps the arithmetic checkable by hand
  dripRate: 1,
  targetMonthlyIncome: 0,
  horizonMonths: 12,
};

describe('projectIncome mechanics', () => {
  it('compounds full DRIP month by month', () => {
    const result = projectIncome(base);
    const [m1, m2] = result.months;

    expect(m1.distribution).toBeCloseTo(100, 8);
    expect(m1.reinvested).toBeCloseTo(100, 8);
    expect(m1.diverted).toBeCloseTo(0, 8);
    expect(m1.incomeCapital).toBeCloseTo(10_100, 8);
    expect(m1.monthlyIncome).toBeCloseTo(101, 8);

    expect(m2.distribution).toBeCloseTo(101, 8);
    expect(m2.incomeCapital).toBeCloseTo(10_201, 8);
    expect(m2.monthlyIncome).toBeCloseTo(102.01, 8);

    expect(result.months).toHaveLength(12);
    expect(result.finalIncomeCapital).toBeCloseTo(10_000 * 1.01 ** 12, 6);
  });

  it('adds recurring contributions before distributions are computed', () => {
    const result = projectIncome({ ...base, monthlyContribution: 500 });
    const m1 = result.months[0];
    // $10,500 earns the first month's distribution, not $10,000.
    expect(m1.contributed).toBe(500);
    expect(m1.distribution).toBeCloseTo(105, 8);
    expect(m1.incomeCapital).toBeCloseTo(10_605, 8);
    expect(result.totalContributed).toBe(6_000);
  });

  it('lands a lump sum in the requested month, treating month 0 as month 1', () => {
    const atMonth3 = projectIncome({ ...base, lumpSum: 5_000, lumpSumMonth: 3 });
    expect(atMonth3.months[0].contributed).toBe(0);
    expect(atMonth3.months[2].contributed).toBe(5_000);

    const immediate = projectIncome({ ...base, lumpSum: 5_000, lumpSumMonth: 0 });
    expect(immediate.months[0].contributed).toBe(5_000);
    expect(immediate.months[0].distribution).toBeCloseTo(150, 8);
  });

  it('withdraws the non-DRIP share and warns that compounding slows', () => {
    const result = projectIncome({ ...base, dripRate: 0.5 });
    const m1 = result.months[0];
    expect(m1.reinvested).toBeCloseTo(50, 8);
    expect(m1.diverted).toBeCloseTo(50, 8);
    expect(m1.incomeCapital).toBeCloseTo(10_050, 8);
    expect(result.warnings.join(' ')).toContain('50% of distributions are modeled as withdrawn');
    expect(result.finalIncomeCapital).toBeLessThan(projectIncome(base).finalIncomeCapital);
  });

  it('clamps the DRIP rate into 0-1 rather than trusting a bad input', () => {
    expect(projectIncome({ ...base, dripRate: 5 }).months[0].reinvested).toBeCloseTo(100, 8);
    expect(projectIncome({ ...base, dripRate: -1 }).months[0].reinvested).toBeCloseTo(0, 8);
  });

  it('bifurcates cash flow to growth capital once the target is being produced', () => {
    const result = projectIncome({
      ...base,
      startingIncomeCapital: 12_000,
      targetMonthlyIncome: 100,
      bifurcationReinvestShare: 0.5,
    });
    const m1 = result.months[0];
    // $120 produced against a $100 target: half stays in the engine, half is
    // redirected to the growth sleeve.
    expect(m1.distribution).toBeCloseTo(120, 8);
    expect(m1.reinvested).toBeCloseTo(60, 8);
    expect(m1.diverted).toBeCloseTo(60, 8);
    expect(m1.growthCapital).toBeCloseTo(60, 8);
    expect(m1.incomeCapital).toBeCloseTo(12_060, 8);
    expect(result.finalGrowthCapital).toBeGreaterThan(0);
  });

  it('does not divert to growth before the target is produced', () => {
    const result = projectIncome({ ...base, targetMonthlyIncome: 1_000, bifurcationReinvestShare: 0.5 });
    expect(result.months.every((m) => m.growthCapital === 0)).toBe(true);
  });

  it('models NAV erosion as capital loss even while cash keeps arriving', () => {
    const eroding = projectIncome({ ...base, annualNavDrift: -0.12 });
    const flat = projectIncome(base);
    expect(eroding.months[0].distribution).toBeLessThan(flat.months[0].distribution);
    expect(eroding.finalIncomeCapital).toBeLessThan(flat.finalIncomeCapital);
    // -1%/month NAV then +1% distribution reinvested ≈ flat capital.
    expect(eroding.months[0].incomeCapital).toBeCloseTo(9_900 + 99, 6);
  });

  it('decays the distribution rate when payout drift is supplied', () => {
    const result = projectIncome({ ...base, annualRateDrift: -0.12 });
    expect(result.months[0].effectiveAnnualRate).toBeCloseTo(0.12, 10);
    expect(result.months[1].effectiveAnnualRate).toBeCloseTo(0.12 * 0.99, 10);
    expect(result.months[11].effectiveAnnualRate).toBeLessThan(0.12);
  });

  it('projects share count only when a price is supplied', () => {
    expect(projectIncome(base).months[0].shares).toBeNull();
    const priced = projectIncome({ ...base, sharePrice: 12.5 });
    expect(priced.months[0].shares).toBeCloseTo(10_100 / 12.5, 8);
  });

  it('marks the month the target is first met and dates it from the snapshot', () => {
    const result = projectIncome({ ...base, targetMonthlyIncome: 102, startDate: AS_OF });
    expect(result.monthsToTarget).toBe(2);
    expect(result.reachedTarget).toBe(true);
    expect(result.targetDate).toBe('2026-08-30');
    expect(result.months[0].date).toBe('2026-07-30');
  });

  it('warns instead of pretending when the target is out of reach in the horizon', () => {
    const result = projectIncome({ ...base, targetMonthlyIncome: 500, horizonMonths: 6 });
    expect(result.monthsToTarget).toBeNull();
    expect(result.reachedTarget).toBe(false);
    expect(result.targetDate).toBeNull();
    expect(result.warnings.join(' ')).toContain('is not reached within 6 months');
  });

  it('reports required capital as target × 12 ÷ rate', () => {
    const result = projectIncome({ ...base, targetMonthlyIncome: 500 });
    expect(result.requiredCapital).toBeCloseTo((500 * 12) / 0.12, 6);
    expect(projectIncome(base).requiredCapital).toBeNull();
  });

  it('warns about an implausible distribution rate rather than projecting it silently', () => {
    const hot = projectIncome({ ...base, annualDistributionRate: 0.9 });
    expect(hot.warnings.join(' ')).toContain('above 60% annualised');
    const none = projectIncome({ ...base, annualDistributionRate: 0 });
    expect(none.warnings.join(' ')).toContain('cannot model income growth');
    expect(none.finalMonthlyIncome).toBe(0);
  });

  it('measures the self-funded share of ending capital', () => {
    const noExternal = projectIncome({ ...base, horizonMonths: 24 });
    const external = 10_000;
    const expected = (noExternal.finalIncomeCapital - external) / noExternal.finalIncomeCapital;
    expect(noExternal.selfFundedShare).toBeCloseTo(expected, 8);
    expect(noExternal.selfFundedShare).toBeGreaterThan(0);

    // A portfolio that produces nothing is 0% self-funded.
    const dead = projectIncome({ ...base, annualDistributionRate: 0, monthlyContribution: 100 });
    expect(dead.selfFundedShare).toBe(0);
  });

  it('clamps the horizon to a sane range', () => {
    expect(projectIncome({ ...base, horizonMonths: 0 }).months).toHaveLength(1);
    expect(projectIncome({ ...base, horizonMonths: 9_999 }).months).toHaveLength(600);
  });

  it('never lets negative starting capital or contributions run the engine backwards', () => {
    const result = projectIncome({ ...base, startingIncomeCapital: -5_000, monthlyContribution: -100 });
    expect(result.months[0].incomeCapital).toBe(0);
    expect(result.totalContributed).toBe(0);
  });
});

const solverBase = {
  startingIncomeCapital: 5_000,
  lumpSum: 0,
  lumpSumMonth: 0,
  annualDistributionRate: 0.4,
  dripRate: 1,
  targetMonthlyIncome: 500,
  sharePrice: 12.5,
};

describe('solveMonthlyContribution', () => {
  it('solves the contribution needed to hit the date, and the answer works', () => {
    const solved = solveMonthlyContribution(solverBase, 24);
    expect(solved.achieved).toBe(true);
    const contribution = solved.monthlyContribution!;
    expect(contribution).toBeGreaterThan(0);

    const verify = projectIncome({ ...solverBase, monthlyContribution: contribution, horizonMonths: 24 });
    expect(verify.reachedTarget).toBe(true);

    // A materially smaller contribution must not reach it — the solved figure is
    // near the true boundary rather than an arbitrary safe number.
    const short = projectIncome({ ...solverBase, monthlyContribution: contribution - 25, horizonMonths: 24 });
    expect(short.reachedTarget).toBe(false);
  });

  it('requires more per month for a shorter deadline', () => {
    const twelve = solveMonthlyContribution(solverBase, 12).monthlyContribution!;
    const eighteen = solveMonthlyContribution(solverBase, 18).monthlyContribution!;
    const twentyFour = solveMonthlyContribution(solverBase, 24).monthlyContribution!;
    expect(twelve).toBeGreaterThan(eighteen);
    expect(eighteen).toBeGreaterThan(twentyFour);
  });

  it('requires more per month under a conservative rate', () => {
    const optimistic = solveMonthlyContribution(solverBase, 24).monthlyContribution!;
    const haircut = solveMonthlyContribution(
      { ...solverBase, annualDistributionRate: 0.4 * 0.75 },
      24,
    ).monthlyContribution!;
    expect(haircut).toBeGreaterThan(optimistic);
  });

  it('returns zero when the target is already being produced', () => {
    const solved = solveMonthlyContribution({ ...solverBase, startingIncomeCapital: 20_000 }, 12);
    expect(solved.monthlyContribution).toBe(0);
    expect(solved.achieved).toBe(true);
  });

  it('returns null rather than a fantasy figure when the deadline is impossible', () => {
    const solved = solveMonthlyContribution(
      { ...solverBase, targetMonthlyIncome: 5_000, annualDistributionRate: 0.01 },
      1,
      { max: 1_000 },
    );
    expect(solved.monthlyContribution).toBeNull();
    expect(solved.achieved).toBe(false);
  });
});

describe('contributionSchedule', () => {
  it('reports total external capital for each deadline', () => {
    const rows = contributionSchedule({ ...solverBase, lumpSum: 1_000 }, [12, 18, 24]);
    expect(rows.map((r) => r.deadlineMonths)).toEqual([12, 18, 24]);
    for (const row of rows) {
      expect(row.totalExternal).toBeCloseTo(row.monthlyContribution! * row.deadlineMonths + 1_000, 6);
    }
    expect(rows[0].monthlyContribution!).toBeGreaterThan(rows[2].monthlyContribution!);
  });
});

describe('buildScenarios', () => {
  const scenarios = buildScenarios(
    { ...solverBase, monthlyContribution: 300, horizonMonths: 36, startDate: AS_OF },
    { conservative: 0.3, base: 0.4, aggressive: 0.4 },
  );

  it('returns conservative, base and aggressive bands in order', () => {
    expect(scenarios.map((s) => s.name)).toEqual(['conservative', 'base', 'aggressive']);
  });

  it('holds the aggressive case flat with no NAV erosion and labels it an upper bound', () => {
    const aggressive = scenarios.find((s) => s.name === 'aggressive')!;
    expect(aggressive.annualNavDrift).toBe(0);
    expect(aggressive.annualRateDrift).toBe(0);
    expect(aggressive.description).toContain('upper bound, not a projection');
  });

  it('decays payout and NAV in the conservative and base cases', () => {
    const conservative = scenarios.find((s) => s.name === 'conservative')!;
    const modelled = scenarios.find((s) => s.name === 'base')!;
    expect(conservative.annualNavDrift).toBeLessThan(modelled.annualNavDrift);
    expect(conservative.annualRateDrift).toBeLessThan(modelled.annualRateDrift);
  });

  it('orders outcomes conservative < base < aggressive', () => {
    const [conservative, modelled, aggressive] = scenarios.map((s) => s.projection.finalMonthlyIncome);
    expect(conservative).toBeLessThan(modelled);
    expect(modelled).toBeLessThan(aggressive);
  });

  it('reaches the target later in the conservative case than the aggressive one', () => {
    const conservative = scenarios[0].projection.monthsToTarget;
    const aggressive = scenarios[2].projection.monthsToTarget;
    expect(aggressive).not.toBeNull();
    if (conservative != null) expect(conservative).toBeGreaterThan(aggressive!);
  });
});
