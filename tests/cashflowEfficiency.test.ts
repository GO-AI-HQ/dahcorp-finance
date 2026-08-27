import { describe, expect, it } from 'vitest';
import {
  computeCashFlowEfficiency,
  rankIncomeCandidates,
  type EfficiencyInput,
} from '../src/core/cashflowEfficiency.js';
import { simpleReturns } from '../src/core/math.js';
import { AS_OF, flatBars, linearBars, makeQuote, steadyWeekly } from './helpers.js';

/** A fund paying a very large distribution out of a collapsing NAV. */
const highYieldBars = linearBars(12, 8, 200);
const highYieldDistributions = steadyWeekly('NVDY', 0.07, 52, { returnOfCapitalPct: 0.8 });
const highYield: EfficiencyInput = {
  symbol: 'NVDY',
  quote: makeQuote('NVDY', 8, { avgVolume: 1_000_000 }),
  bars: highYieldBars,
  distributions: highYieldDistributions,
  asOf: AS_OF,
  basis: 'avg13w',
};

/** A fund paying a modest distribution while holding its NAV. */
const steadyDistributions = steadyWeekly('QQQI', 0.06, 52, { returnOfCapitalPct: 0.2 });
const steady: EfficiencyInput = {
  symbol: 'QQQI',
  quote: makeQuote('QQQI', 12, { avgVolume: 1_000_000 }),
  bars: flatBars(12, 200),
  distributions: steadyDistributions,
  asOf: AS_OF,
  basis: 'avg13w',
};

describe('computeCashFlowEfficiency', () => {
  const result = computeCashFlowEfficiency(highYield);

  it('reports cash per invested dollar across every trailing window', () => {
    expect(result.cashPerDollar4w).toBeCloseTo((4 * 0.07) / 8, 10);
    expect(result.cashPerDollar13w).toBeCloseTo((13 * 0.07) / 8, 10);
    expect(result.cashPerDollar26w).toBeCloseTo((26 * 0.07) / 8, 10);
    expect(result.cashPerDollar52w).toBeCloseTo((52 * 0.07) / 8, 10);
  });

  it('scores on eleven weighted components that sum to one', () => {
    const weightTotal = result.components.reduce((acc, c) => acc + c.weight, 0);
    expect(result.components).toHaveLength(11);
    expect(weightTotal).toBeCloseTo(1, 10);
    for (const component of result.components) {
      expect(component.score).toBeGreaterThanOrEqual(0);
      expect(component.score).toBeLessThanOrEqual(1);
      expect(component.detail.length).toBeGreaterThan(10);
    }
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('caps the weight any yield-like component can carry', () => {
    const cashWeight = result.components
      .filter((c) => c.key.startsWith('cash_'))
      .reduce((acc, c) => acc + c.weight, 0);
    const qualityWeight = result.components
      .filter((c) => ['total_return', 'nav_preservation', 'roc', 'drawdown'].includes(c.key))
      .reduce((acc, c) => acc + c.weight, 0);
    expect(cashWeight).toBeLessThan(0.5);
    expect(qualityWeight).toBeGreaterThan(cashWeight);
  });

  it('warns about NAV erosion, negative total return and return of capital', () => {
    const joined = result.warnings.join(' ');
    expect(result.navChange26w!).toBeLessThan(-0.15);
    expect(result.totalReturn52w!).toBeLessThan(0);
    expect(joined).toContain('26 weeks');
    expect(joined).toContain('total return');
    expect(joined).toContain('return of capital');
  });

  it('flags thin history and neutralises the stability component', () => {
    const thin = computeCashFlowEfficiency({
      ...steady,
      distributions: steadyWeekly('QQQI', 0.06, 2),
    });
    expect(thin.stats.thinHistory).toBe(true);
    expect(thin.components.find((c) => c.key === 'stability')!.score).toBe(0.35);
    expect(thin.warnings.join(' ')).toContain('low-confidence');
  });

  it('penalises overlap with an underlying the portfolio already owns', () => {
    const overlapping = computeCashFlowEfficiency({ ...highYield, exposureWeights: { nvda: 0.5 } });
    const clean = computeCashFlowEfficiency({ ...highYield, exposureWeights: { nvda: 0 } });
    expect(overlapping.overlapPct).toBe(0.5);
    expect(overlapping.warnings.join(' ')).toContain('NVDA');
    const diversification = (r: typeof clean) => r.components.find((c) => c.key === 'diversification')!.score;
    expect(diversification(overlapping)).toBeLessThan(diversification(clean));
  });

  it('penalises correlation to positions already held', () => {
    const correlated = computeCashFlowEfficiency({
      ...highYield,
      holdingReturnSeries: { NVDA: simpleReturns(highYieldBars.map((b) => b.close)) },
    });
    expect(correlated.maxCorrelationToHoldings!).toBeGreaterThan(0.9);
    expect(correlated.score).toBeLessThan(computeCashFlowEfficiency(highYield).score);
  });

  it('ignores the candidate itself when measuring correlation to holdings', () => {
    const self = computeCashFlowEfficiency({
      ...highYield,
      holdingReturnSeries: { NVDY: simpleReturns(highYieldBars.map((b) => b.close)) },
    });
    expect(self.maxCorrelationToHoldings).toBeNull();
  });

  it('measures the bid/ask spread when the quote carries one', () => {
    const wide = computeCashFlowEfficiency({
      ...steady,
      quote: makeQuote('QQQI', 12, { bid: 11.9, ask: 12.1, avgVolume: 1_000_000 }),
    });
    expect(wide.spreadPct).toBeCloseTo(0.2 / 12, 10);
    expect(wide.warnings.join(' ')).toContain('spread');
  });

  it('is deterministic for identical inputs', () => {
    expect(computeCashFlowEfficiency(highYield).score).toBe(computeCashFlowEfficiency(highYield).score);
  });
});

describe('rankIncomeCandidates', () => {
  const ranked = rankIncomeCandidates([highYield, steady]);

  it('does not rank by distribution yield', () => {
    const nvdy = ranked.find((r) => r.symbol === 'NVDY')!;
    const qqqi = ranked.find((r) => r.symbol === 'QQQI')!;
    // The high-yield fund pays far more cash per dollar...
    expect(nvdy.cashPerDollar13w!).toBeGreaterThan(qqqi.cashPerDollar13w!);
    expect(nvdy.forwardRate!).toBeGreaterThan(qqqi.forwardRate!);
    // ...and still ranks below the fund that actually preserved capital.
    expect(nvdy.score).toBeLessThan(qqqi.score);
    expect(ranked[0].symbol).toBe('QQQI');
  });

  it('returns every candidate, ordered by score', () => {
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it('exposes the component breakdown behind each ranking', () => {
    for (const row of ranked) {
      expect(row.components.length).toBe(11);
      expect(row.stats.symbol).toBe(row.symbol);
    }
  });
});
