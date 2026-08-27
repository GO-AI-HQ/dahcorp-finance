import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG } from '../src/core/config.js';
import { analyzePortfolio } from '../src/core/portfolio.js';
import {
  buildIncomeSummary,
  computeIncomeVelocity,
  isIncomeProducing,
  milestoneProgress,
  monthlyReceivedIncome,
  requiredCapitalForIncome,
  weeklyDistributionSeries,
} from '../src/core/income.js';
import { AS_OF, makeAccount, makeHolding, makeIncomeEvent, makeSnapshot, quotesFor, steadyWeekly } from './helpers.js';
import { addDays } from '../src/core/dates.js';
import { flatBars } from './helpers.js';

/*
 * Seeded Phase 1 engine: Robinhood 7.90 NVDY, Schwab 11 YMAG.
 * Every expected figure below is derived from these inputs — none of them is a
 * constant lifted from the plan.
 */
const NVDY_PRICE = 12.5;
const YMAG_PRICE = 11.12;
const NVDY_WEEKLY = 0.2;
const YMAG_WEEKLY = 0.16;

const NVDY_ANNUAL_PER_SHARE = NVDY_WEEKLY * 52;
const YMAG_ANNUAL_PER_SHARE = YMAG_WEEKLY * 52;
const CAPITAL = 7.9 * NVDY_PRICE + 11 * YMAG_PRICE;
const FORWARD_ANNUAL = 7.9 * NVDY_ANNUAL_PER_SHARE + 11 * YMAG_ANNUAL_PER_SHARE;
const FORWARD_MONTHLY = FORWARD_ANNUAL / 12;
const BLENDED_RATE = FORWARD_ANNUAL / CAPITAL;

function engineSnapshot(
  over: {
    incomeEvents?: ReturnType<typeof makeIncomeEvent>[];
    nvdyRoc?: number;
    ymagRoc?: number;
    nvdyWeeks?: number;
  } = {},
) {
  return makeSnapshot({
    accounts: [
      makeAccount('rh-1', { broker: 'robinhood', name: 'Active Accumulation' }),
      makeAccount('sch-1', { broker: 'schwab', name: 'Income / Value / Cyclical' }),
    ],
    holdings: [makeHolding('rh-1', 'NVDY', 7.9, 12), makeHolding('sch-1', 'YMAG', 11, 11.5)],
    quotes: quotesFor({ NVDY: NVDY_PRICE, YMAG: YMAG_PRICE }),
    distributions: [
      ...steadyWeekly('NVDY', NVDY_WEEKLY, over.nvdyWeeks ?? 52, { returnOfCapitalPct: over.nvdyRoc }),
      ...steadyWeekly('YMAG', YMAG_WEEKLY, 52, { returnOfCapitalPct: over.ymagRoc }),
    ],
    priceHistory: { NVDY: flatBars(NVDY_PRICE, 200), YMAG: flatBars(YMAG_PRICE, 200) },
    incomeEvents: over.incomeEvents ?? [],
  });
}

function summaryFor(snapshot = engineSnapshot(), config = DEFAULT_STRATEGY_CONFIG) {
  return buildIncomeSummary(snapshot, analyzePortfolio(snapshot, config), config);
}

describe('isIncomeProducing', () => {
  it('counts the income engine and dividend REIT sleeves only', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'NVDY', 1, 12), makeHolding('rh-1', 'SOXL', 1, 20)],
      quotes: quotesFor({ NVDY: 12.5, SOXL: 25 }),
    });
    const positions = analyzePortfolio(snapshot, DEFAULT_STRATEGY_CONFIG).positions;
    expect(positions.filter(isIncomeProducing).map((p) => p.symbol)).toEqual(['NVDY']);
  });
});

describe('buildIncomeSummary', () => {
  it('models forward income from shares × per-share distribution on the active basis', () => {
    const income = summaryFor();
    const nvdy = income.positions.find((p) => p.symbol === 'NVDY')!;

    expect(income.basis).toBe('avg13w');
    expect(nvdy.weeklyPerShare).toBeCloseTo(NVDY_WEEKLY, 10);
    expect(nvdy.monthlyPerShare).toBeCloseTo((NVDY_WEEKLY * 52) / 12, 10);
    expect(nvdy.weeklyIncome).toBeCloseTo(7.9 * NVDY_WEEKLY, 10);
    expect(nvdy.monthlyIncome).toBeCloseTo((7.9 * NVDY_WEEKLY * 52) / 12, 10);
    expect(nvdy.annualIncome).toBeCloseTo(7.9 * NVDY_ANNUAL_PER_SHARE, 10);

    expect(income.forwardWeeklyIncome).toBeCloseTo(7.9 * NVDY_WEEKLY + 11 * YMAG_WEEKLY, 10);
    expect(income.forwardMonthlyIncome).toBeCloseTo(FORWARD_MONTHLY, 10);
    expect(income.forwardAnnualIncome).toBeCloseTo(FORWARD_ANNUAL, 10);
  });

  it('blends the distribution rate over deployed income capital, not over all assets', () => {
    const income = summaryFor();
    expect(income.incomeEngineCapital).toBeCloseTo(CAPITAL, 10);
    expect(income.blendedDistributionRate).toBeCloseTo(BLENDED_RATE, 10);
    // The rate is a distribution rate against price — never presented as return.
    const nvdy = income.positions.find((p) => p.symbol === 'NVDY')!;
    expect(nvdy.distributionRate).toBeCloseTo(NVDY_ANNUAL_PER_SHARE / NVDY_PRICE, 10);
  });

  it('applies the conservative haircut to modeled income and to the blended rate', () => {
    const income = summaryFor();
    expect(income.haircut).toBe(0.25);
    expect(income.conservativeMonthlyIncome).toBeCloseTo(FORWARD_MONTHLY * 0.75, 10);
    expect(income.blendedConservativeRate).toBeCloseTo(BLENDED_RATE * 0.75, 10);
    expect(income.conservativeMonthlyIncome).toBeLessThan(income.forwardMonthlyIncome);
  });

  it('separates cash actually received from modeled forward income', () => {
    const events = [
      makeIncomeEvent('rh-1', 'NVDY', 1.58, addDays(AS_OF, -2)),
      makeIncomeEvent('rh-1', 'NVDY', 1.58, addDays(AS_OF, -9)),
      makeIncomeEvent('sch-1', 'YMAG', 1.76, addDays(AS_OF, -20)),
      makeIncomeEvent('sch-1', 'YMAG', 1.76, addDays(AS_OF, -45)),
      makeIncomeEvent('sch-1', 'YMAG', 1.76, addDays(AS_OF, -200)),
    ];
    const income = summaryFor(engineSnapshot({ incomeEvents: events }));
    expect(income.received7d).toBeCloseTo(1.58, 8);
    expect(income.received30d).toBeCloseTo(1.58 + 1.58 + 1.76, 8);
    expect(income.received90d).toBeCloseTo(1.58 + 1.58 + 1.76 + 1.76, 8);
    expect(income.receivedLifetime).toBeCloseTo(8.44, 8);
    // Received cash is audited history and must not be confused with the model.
    expect(income.received30d).not.toBeCloseTo(income.forwardMonthlyIncome, 2);
  });

  it('reports economic income net of return of capital rather than treating cash as profit', () => {
    const income = summaryFor(engineSnapshot({ nvdyRoc: 0.8, ymagRoc: 0.5 }));
    const nvdyMonthly = (7.9 * NVDY_WEEKLY * 52) / 12;
    const ymagMonthly = (11 * YMAG_WEEKLY * 52) / 12;
    expect(income.estimatedEconomicIncomeMonthly).toBeCloseTo(nvdyMonthly * 0.2 + ymagMonthly * 0.5, 8);
    expect(income.estimatedEconomicIncomeMonthly!).toBeLessThan(income.forwardMonthlyIncome);
    expect(income.flags.join(' ')).toContain('return of capital');
  });

  it('returns null economic income when no position reports ROC, instead of assuming it is clean', () => {
    const income = summaryFor();
    expect(income.estimatedEconomicIncomeMonthly).toBeNull();
    expect(income.flags.join(' ')).not.toContain('return of capital');
  });

  it('always flags mock data', () => {
    expect(summaryFor().flags).toContain('Snapshot contains mock fixture data.');
  });

  it('flags thin distribution history at the position and summary level', () => {
    const income = summaryFor(engineSnapshot({ nvdyWeeks: 2 }));
    const nvdy = income.positions.find((p) => p.symbol === 'NVDY')!;
    expect(nvdy.stats.thinHistory).toBe(true);
    expect(nvdy.flags).toContain('Thin distribution history');
    expect(income.flags.join(' ')).toContain('thin distribution history');
  });

  it('flags NAV erosion and negative total return on the position card', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'NVDY', 7.9, 12)],
      quotes: quotesFor({ NVDY: 5 }),
      // Price collapses 12 → 5 while paying a modest $0.06/week.
      priceHistory: { NVDY: [...flatBars(12, 100, addDays(AS_OF, -100)), ...flatBars(5, 100)] },
      distributions: steadyWeekly('NVDY', 0.06, 52),
    });
    const nvdy = summaryFor(snapshot).positions[0];
    expect(nvdy.navChange26w!).toBeLessThan(-0.1);
    expect(nvdy.totalReturn52w!).toBeLessThan(0);
    expect(nvdy.flags).toContain('NAV erosion over 26w');
    expect(nvdy.flags).toContain('Negative 52w total return');
  });

  it('reports the self-funding milestone across the engine', () => {
    const income = summaryFor();
    const milestone = income.selfFundingMilestone;
    expect(milestone.perSymbol.map((p) => p.symbol).sort()).toEqual(['NVDY', 'YMAG']);
    expect(milestone.allSelfFunding).toBe(false);
    expect(milestone.combinedProgress).toBeGreaterThan(0);
    expect(milestone.combinedProgress).toBeLessThan(1);
    // Shares needed for one share/month = price ÷ monthly distribution per share.
    const nvdy = milestone.perSymbol.find((p) => p.symbol === 'NVDY')!;
    expect(nvdy.sharesRequired).toBeCloseTo(NVDY_PRICE / (NVDY_ANNUAL_PER_SHARE / 12), 8);
    expect(milestone.totalCapitalRequired).toBeGreaterThan(0);
  });

  it('produces an empty but valid summary with no positions', () => {
    const income = summaryFor(makeSnapshot({ accounts: [makeAccount('rh-1', { cash: 500 })] }));
    expect(income.positions).toEqual([]);
    expect(income.forwardMonthlyIncome).toBe(0);
    expect(income.incomeEngineCapital).toBe(0);
    expect(income.blendedDistributionRate).toBeNull();
    expect(income.blendedConservativeRate).toBeNull();
    expect(income.conservativeMonthlyIncome).toBe(0);
  });

  it('follows the configured basis rather than a fixed window', () => {
    // A rising payment history makes the basis choice observable: the 4-week
    // average is higher than the 52-week average.
    const rising = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'NVDY', 10, 12)],
      quotes: quotesFor({ NVDY: 12.5 }),
      distributions: [
        ...steadyWeekly('NVDY', 0.1, 52).slice(0, 48),
        ...steadyWeekly('NVDY', 0.3, 4),
      ],
      priceHistory: { NVDY: flatBars(12.5, 200) },
    });
    const short = summaryFor(rising, { ...DEFAULT_STRATEGY_CONFIG, distributionBasis: 'avg4w' });
    const long = summaryFor(rising, { ...DEFAULT_STRATEGY_CONFIG, distributionBasis: 'avg52w' });
    expect(short.forwardMonthlyIncome).toBeGreaterThan(long.forwardMonthlyIncome);
    expect(short.basis).toBe('avg4w');
  });
});

describe('requiredCapitalForIncome', () => {
  it('is desired monthly income × 12 ÷ modeled rate', () => {
    expect(requiredCapitalForIncome(500, 0.4)).toBeCloseTo(15_000, 8);
    expect(requiredCapitalForIncome(1000, 0.4)).toBeCloseTo(30_000, 8);
  });

  it('moves with the modeled rate — the $500/mo requirement is not a constant', () => {
    const optimistic = requiredCapitalForIncome(500, 0.5)!;
    const conservative = requiredCapitalForIncome(500, 0.5 * 0.75)!;
    expect(conservative).toBeGreaterThan(optimistic);
    expect(conservative).toBeCloseTo(optimistic / 0.75, 6);
  });

  it('returns null rather than Infinity when no rate is known', () => {
    expect(requiredCapitalForIncome(500, 0)).toBeNull();
    expect(requiredCapitalForIncome(500, -0.1)).toBeNull();
  });
});

describe('milestoneProgress', () => {
  it('measures progress and the capital gap for every milestone', () => {
    const income = summaryFor();
    const rows = milestoneProgress(income, DEFAULT_STRATEGY_CONFIG);
    expect(rows.map((r) => r.targetMonthlyIncome)).toEqual([150, 500, 1000, 2500, 5000]);

    const b = rows.find((r) => r.id === 'B')!;
    expect(b.progress).toBeCloseTo(FORWARD_MONTHLY / 500, 10);
    expect(b.reached).toBe(false);
    expect(b.requiredCapital).toBeCloseTo((500 * 12) / BLENDED_RATE, 6);
    expect(b.capitalGap).toBeCloseTo(b.requiredCapital! - CAPITAL, 6);
    expect(b.requiredCapitalConservative!).toBeGreaterThan(b.requiredCapital!);
  });

  it('marks a milestone reached and never reports a negative capital gap', () => {
    const income = { ...summaryFor(), forwardMonthlyIncome: 600, incomeEngineCapital: 1_000_000 };
    const a = milestoneProgress(income, DEFAULT_STRATEGY_CONFIG).find((r) => r.id === 'A')!;
    expect(a.reached).toBe(true);
    expect(a.progress).toBeCloseTo(4, 8);
    expect(a.capitalGap).toBe(0);
  });

  it('reports null capital requirements when no rate can be modeled', () => {
    const income = summaryFor(makeSnapshot({ accounts: [makeAccount('rh-1')] }));
    const rows = milestoneProgress(income, DEFAULT_STRATEGY_CONFIG);
    expect(rows.every((r) => r.requiredCapital === null && r.capitalGap === null)).toBe(true);
  });
});

describe('computeIncomeVelocity', () => {
  it('decomposes new monthly income into contribution and DRIP components', () => {
    const income = summaryFor();
    const config = { ...DEFAULT_STRATEGY_CONFIG, monthlyContribution: 300, dripRate: 1 };
    const velocity = computeIncomeVelocity({ income, config });
    const monthlyRate = BLENDED_RATE / 12;
    expect(velocity.contributionDriven).toBeCloseTo(300 * monthlyRate, 10);
    expect(velocity.dripDriven).toBeCloseTo(FORWARD_MONTHLY * monthlyRate, 10);
    expect(velocity.marketDriven).toBe(0);
    expect(velocity.total).toBeCloseTo(velocity.contributionDriven + velocity.dripDriven, 10);
    expect(velocity.notes.join(' ')).toContain('No prior income snapshot');
  });

  it('scales the DRIP component with the configured reinvestment rate', () => {
    const income = summaryFor();
    const full = computeIncomeVelocity({ income, config: { ...DEFAULT_STRATEGY_CONFIG, dripRate: 1 } });
    const half = computeIncomeVelocity({ income, config: { ...DEFAULT_STRATEGY_CONFIG, dripRate: 0.5 } });
    expect(half.dripDriven).toBeCloseTo(full.dripDriven / 2, 10);
  });

  it('treats the market component as the residual against a prior snapshot', () => {
    const income = summaryFor();
    const config = DEFAULT_STRATEGY_CONFIG;
    const prior = income.forwardMonthlyIncome - 2;
    const velocity = computeIncomeVelocity({ income, config, priorMonthlyIncome: prior, priorPeriodMonths: 1 });
    expect(velocity.total).toBeCloseTo(2, 8);
    expect(velocity.marketDriven).toBeCloseTo(2 - velocity.contributionDriven - velocity.dripDriven, 8);
    expect(velocity.notes.join(' ')).toContain('residual');
  });

  it('reports months to milestone, 0 when reached and null when stalled', () => {
    const income = summaryFor();
    const reached = computeIncomeVelocity({
      income: { ...income, forwardMonthlyIncome: 900 },
      config: DEFAULT_STRATEGY_CONFIG,
    });
    expect(reached.linearMonthsToMilestone).toBe(0);

    const stalled = computeIncomeVelocity({
      income: { ...income, blendedDistributionRate: 0, forwardMonthlyIncome: 10 },
      config: { ...DEFAULT_STRATEGY_CONFIG, monthlyContribution: 0 },
    });
    expect(stalled.total).toBe(0);
    expect(stalled.linearMonthsToMilestone).toBeNull();

    const moving = computeIncomeVelocity({ income, config: DEFAULT_STRATEGY_CONFIG });
    const gap = 500 - income.forwardMonthlyIncome;
    expect(moving.linearMonthsToMilestone).toBeCloseTo(gap / moving.total, 6);
  });
});

describe('monthlyReceivedIncome', () => {
  it('buckets received cash by calendar month in ascending order', () => {
    const events = [
      makeIncomeEvent('rh-1', 'NVDY', 2, '2026-06-05'),
      makeIncomeEvent('rh-1', 'NVDY', 3, '2026-06-12'),
      makeIncomeEvent('sch-1', 'YMAG', 4, '2026-05-30'),
    ];
    expect(monthlyReceivedIncome(events)).toEqual([
      { month: '2026-05', amount: 4 },
      { month: '2026-06', amount: 5 },
    ]);
  });

  it('returns an empty series when nothing has been received', () => {
    expect(monthlyReceivedIncome([])).toEqual([]);
  });
});

describe('weeklyDistributionSeries', () => {
  it('returns the most recent payments for one symbol, oldest first', () => {
    const distributions = [...steadyWeekly('NVDY', 0.2, 52), ...steadyWeekly('YMAG', 0.16, 52)];
    const series = weeklyDistributionSeries(distributions, 'nvdy', 4);
    expect(series).toHaveLength(4);
    expect(series.every((s) => s.amount === 0.2)).toBe(true);
    expect(series[0].date < series[3].date).toBe(true);
    expect(series[3].date).toBe(addDays(AS_OF, -1));
  });

  it('is empty for a symbol that has never paid', () => {
    expect(weeklyDistributionSeries(steadyWeekly('NVDY', 0.2, 4), 'YMAG')).toEqual([]);
  });
});
