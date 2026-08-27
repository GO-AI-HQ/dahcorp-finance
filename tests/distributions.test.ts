import { describe, expect, it } from 'vitest';
import {
  annualPerShare,
  applyHaircut,
  computeDistributionStats,
  decomposeEconomics,
  forwardDistributionRate,
  monthlyPerShare,
  perPaymentForBasis,
  priceChangeOverDays,
  totalReturnOverDays,
  weeklyEquivalentPerShare,
} from '../src/core/distributions.js';
import { WEEKS_PER_MONTH, WEEKS_PER_YEAR } from '../src/core/math.js';
import { addDays } from '../src/core/dates.js';
import { AS_OF, barsEndingAt, payments, steadyWeekly } from './helpers.js';

describe('computeDistributionStats', () => {
  const steady = computeDistributionStats('NVDY', steadyWeekly('NVDY', 0.2, 52), AS_OF);

  it('counts payments per trailing window rather than annualising a single payment', () => {
    expect(steady.count4w).toBe(4);
    expect(steady.count13w).toBe(13);
    expect(steady.count26w).toBe(26);
    expect(steady.count52w).toBe(52);
    expect(steady.paid13w).toBeCloseTo(13 * 0.2, 10);
    expect(steady.paid52w).toBeCloseTo(52 * 0.2, 10);
  });

  it('reports averages per payment, not per week', () => {
    expect(steady.avg4w).toBeCloseTo(0.2, 10);
    expect(steady.avg52w).toBeCloseTo(0.2, 10);
    expect(steady.latest).toBe(0.2);
    expect(steady.latestPayDate).toBe(addDays(AS_OF, -1));
  });

  it('scores a perfectly steady payer as stable with a flat trend', () => {
    expect(steady.stability).toBeCloseTo(1, 8);
    expect(steady.trend).toBeCloseTo(0, 10);
    expect(steady.thinHistory).toBe(false);
  });

  it('detects a declining payment trend', () => {
    const declining = computeDistributionStats(
      'NVDY',
      payments('NVDY', Array.from({ length: 30 }, (_, i) => Number((0.4 - i * 0.008).toFixed(4)))),
      AS_OF,
    );
    expect(declining.trend).toBeLessThan(0);
    expect(declining.latest).toBeLessThan(declining.avg26w!);
  });

  it('penalises erratic payments through the stability score', () => {
    const erratic = computeDistributionStats(
      'NVDY',
      payments('NVDY', [0.05, 0.6, 0.02, 0.55, 0.04, 0.7, 0.03, 0.5, 0.06, 0.65, 0.02, 0.58, 0.05]),
      AS_OF,
    );
    expect(erratic.stability).toBeLessThan(0.5);
    expect(steady.stability).toBeGreaterThan(erratic.stability);
  });

  it('flags thin history instead of modelling from one or two payments', () => {
    const thin = computeDistributionStats('NVDY', steadyWeekly('NVDY', 0.2, 2), AS_OF);
    expect(thin.count13w).toBe(2);
    expect(thin.thinHistory).toBe(true);
    expect(thin.stability).toBe(0.5);
  });

  it('returns nulls for windows with no payments', () => {
    const empty = computeDistributionStats('NVDY', [], AS_OF);
    expect(empty.latest).toBeNull();
    expect(empty.avg13w).toBeNull();
    expect(empty.paid52w).toBe(0);
    expect(empty.frequency).toBe('irregular');
    expect(empty.paymentsPerYear).toBe(0);
  });

  it('ignores other symbols in the event list', () => {
    const mixed = [...steadyWeekly('NVDY', 0.2, 13), ...steadyWeekly('YMAG', 0.9, 13)];
    expect(computeDistributionStats('nvdy', mixed, AS_OF).avg13w).toBeCloseTo(0.2, 10);
    expect(computeDistributionStats('YMAG', mixed, AS_OF).avg13w).toBeCloseTo(0.9, 10);
  });

  it('weights the return-of-capital share by cash paid', () => {
    const events = payments('NVDY', [1, 0.2]).map((e, i) => ({
      ...e,
      returnOfCapitalPct: i === 0 ? 0.9 : 0.1,
    }));
    const stats = computeDistributionStats('NVDY', events, AS_OF);
    expect(stats.returnOfCapitalPct).toBeCloseTo((1 * 0.9 + 0.2 * 0.1) / 1.2, 10);
  });

  it('leaves the return-of-capital share null when the fund does not report it', () => {
    expect(steady.returnOfCapitalPct).toBeNull();
  });
});

describe('basis selection', () => {
  const stats = computeDistributionStats('NVDY', steadyWeekly('NVDY', 0.25, 52), AS_OF);

  it('converts a weekly payer straight through', () => {
    expect(weeklyEquivalentPerShare(stats, 'avg13w')).toBeCloseTo(0.25, 10);
    expect(monthlyPerShare(stats, 'avg13w')).toBeCloseTo(0.25 * WEEKS_PER_MONTH, 10);
    expect(annualPerShare(stats, 'avg13w')).toBeCloseTo(0.25 * WEEKS_PER_YEAR, 10);
  });

  it('puts a monthly payer on the same weekly axis', () => {
    const monthly = computeDistributionStats(
      'QQQI',
      payments('QQQI', [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], { intervalDays: 30, frequency: 'monthly' }),
      AS_OF,
    );
    expect(monthly.paymentsPerYear).toBe(12);
    expect(weeklyEquivalentPerShare(monthly, 'avg13w')).toBeCloseTo((0.5 * 12) / 52, 10);
  });

  it('falls back to observed cash for an irregular cadence rather than inventing a schedule', () => {
    const irregular = computeDistributionStats(
      'AMZN',
      payments('AMZN', [0.3, 0.3], { intervalDays: 120, frequency: 'irregular' }),
      AS_OF,
    );
    expect(irregular.paymentsPerYear).toBe(0);
    expect(weeklyEquivalentPerShare(irregular, 'avg52w')).toBeCloseTo(0.6 / 52, 10);
  });

  it('walks the fallback chain when the requested window is empty', () => {
    const stale = computeDistributionStats(
      'NVDY',
      payments('NVDY', [0.5, 0.5, 0.5], { intervalDays: 30, asOf: addDays(AS_OF, -60) }),
      AS_OF,
    );
    expect(stale.avg4w).toBeNull();
    expect(perPaymentForBasis(stale, 'avg4w')).toBeCloseTo(0.5, 10);
  });

  it('returns null when no window has a positive payment', () => {
    const empty = computeDistributionStats('NVDY', [], AS_OF);
    expect(perPaymentForBasis(empty, 'latest')).toBeNull();
    expect(weeklyEquivalentPerShare(empty, 'latest')).toBeNull();
    expect(annualPerShare(empty, 'avg13w')).toBeNull();
  });
});

describe('rates and haircuts', () => {
  const stats = computeDistributionStats('NVDY', steadyWeekly('NVDY', 0.2, 52), AS_OF);

  it('models a forward distribution rate from price, not from an advertised yield', () => {
    const rate = forwardDistributionRate(stats, 'avg13w', 12.5)!;
    expect(rate).toBeCloseTo((0.2 * 52) / 12.5, 10);
    // The same fund at a higher price models a lower rate.
    expect(forwardDistributionRate(stats, 'avg13w', 25)!).toBeCloseTo(rate / 2, 10);
  });

  it('refuses to model a rate without a usable price', () => {
    expect(forwardDistributionRate(stats, 'avg13w', 0)).toBeNull();
    expect(forwardDistributionRate(stats, 'avg13w', -3)).toBeNull();
  });

  it('applies and bounds the conservative haircut', () => {
    expect(applyHaircut(100, 0.25)).toBeCloseTo(75, 10);
    expect(applyHaircut(100, 0)).toBeCloseTo(100, 10);
    expect(applyHaircut(100, 1)).toBeCloseTo(5, 10);
    expect(applyHaircut(100, -1)).toBeCloseTo(100, 10);
    expect(applyHaircut(null, 0.25)).toBeNull();
  });
});

describe('price and total return', () => {
  it('measures price change across the trailing window', () => {
    const bars = barsEndingAt([...(new Array(100).fill(10) as number[]), ...(new Array(100).fill(11) as number[])]);
    expect(priceChangeOverDays(bars, AS_OF, 182)).toBeCloseTo(0.1, 10);
  });

  it('needs at least two bars', () => {
    expect(priceChangeOverDays([{ date: AS_OF, close: 10 }], AS_OF, 182)).toBeNull();
    expect(priceChangeOverDays([], AS_OF, 30)).toBeNull();
  });

  it('adds distributions to price change to produce total return', () => {
    const bars = barsEndingAt([
      ...(new Array(150).fill(12) as number[]),
      ...(new Array(150).fill(10.8) as number[]),
    ]);
    const result = totalReturnOverDays(bars, steadyWeekly('NVDY', 0.03, 52), AS_OF, 364)!;
    expect(result.priceReturn).toBeCloseTo(-0.1, 10);
    expect(result.distributionReturn).toBeCloseTo((52 * 0.03) / 12, 10);
    expect(result.totalReturn).toBeCloseTo(result.priceReturn + result.distributionReturn, 12);
    expect(result.totalReturn).toBeGreaterThan(0);
  });

  it('reports a negative total return when distributions do not cover NAV decline', () => {
    const bars = barsEndingAt([
      ...(new Array(150).fill(20) as number[]),
      ...(new Array(150).fill(13) as number[]),
    ]);
    const result = totalReturnOverDays(bars, steadyWeekly('NVDY', 0.05, 52), AS_OF, 364)!;
    expect(result.priceReturn).toBeCloseTo(-0.35, 10);
    expect(result.totalReturn).toBeLessThan(0);
  });
});

describe('decomposeEconomics', () => {
  it('separates return of capital from the income portion of received cash', () => {
    const result = decomposeEconomics({
      shares: 100,
      startPrice: 12,
      endPrice: 11.5,
      cashPerShare: 1,
      returnOfCapitalPct: 0.6,
    });
    expect(result.cashReceived).toBeCloseTo(100, 10);
    expect(result.estimatedReturnOfCapital).toBeCloseTo(60, 10);
    expect(result.estimatedIncomePortion).toBeCloseTo(40, 10);
    expect(result.navChange).toBeCloseTo(-50, 10);
    expect(result.economicProfit).toBeCloseTo(50, 10);
    expect(result.navErosionExceedsCash).toBe(false);
  });

  it('never treats received cash as profit when NAV fell by more than the cash paid', () => {
    const result = decomposeEconomics({
      shares: 100,
      startPrice: 12,
      endPrice: 10,
      cashPerShare: 1,
      returnOfCapitalPct: 0.8,
    });
    expect(result.cashReceived).toBeCloseTo(100, 10);
    expect(result.navChange).toBeCloseTo(-200, 10);
    expect(result.economicProfit).toBeCloseTo(-100, 10);
    expect(result.navErosionExceedsCash).toBe(true);
  });

  it('treats an unreported return-of-capital share as zero without claiming to know it', () => {
    const result = decomposeEconomics({
      shares: 10,
      startPrice: 10,
      endPrice: 10,
      cashPerShare: 0.5,
      returnOfCapitalPct: null,
    });
    expect(result.estimatedReturnOfCapital).toBe(0);
    expect(result.estimatedIncomePortion).toBeCloseTo(5, 10);
    expect(result.navErosionExceedsCash).toBe(false);
  });
});
