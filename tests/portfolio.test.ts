import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG } from '../src/core/config.js';
import { analyzePortfolio, buildPositionViews, exposureWeights } from '../src/core/portfolio.js';
import { AS_OF, makeAccount, makeHolding, makeSnapshot, quotesFor } from './helpers.js';

/**
 * Portfolio aggregation across the two Phase 1 taxable accounts:
 * Robinhood holds 7.90 NVDY, Schwab holds 11 YMAG.
 */
const NVDY_PRICE = 12.5;
const YMAG_PRICE = 11.12;

function twoAccountSnapshot(over: { rhCash?: number; schCash?: number } = {}) {
  return makeSnapshot({
    accounts: [
      makeAccount('rh-1', { broker: 'robinhood', name: 'Active Accumulation', cash: over.rhCash ?? 0 }),
      makeAccount('sch-1', { broker: 'schwab', name: 'Income / Value / Cyclical', cash: over.schCash ?? 0 }),
    ],
    holdings: [
      makeHolding('rh-1', 'NVDY', 7.9, 12.0),
      makeHolding('sch-1', 'YMAG', 11, 11.5),
    ],
    quotes: quotesFor({ NVDY: NVDY_PRICE, YMAG: YMAG_PRICE }),
  });
}

describe('buildPositionViews', () => {
  it('prices the seeded positions and sorts by market value', () => {
    const views = buildPositionViews(twoAccountSnapshot());
    expect(views.map((v) => v.symbol)).toEqual(['YMAG', 'NVDY']);

    const nvdy = views.find((v) => v.symbol === 'NVDY')!;
    expect(nvdy.marketValue).toBeCloseTo(7.9 * NVDY_PRICE, 10);
    expect(nvdy.costBasisPerShare).toBeCloseTo(12, 6);
    expect(nvdy.unrealizedPL).toBeCloseTo(7.9 * NVDY_PRICE - 94.8, 6);
    expect(nvdy.unrealizedPLPct).toBeCloseTo((7.9 * NVDY_PRICE - 94.8) / 94.8, 8);
  });

  it('classifies sleeve, leverage and underlying exposure from the instrument universe', () => {
    const views = buildPositionViews(twoAccountSnapshot());
    const nvdy = views.find((v) => v.symbol === 'NVDY')!;
    expect(nvdy.sleeve).toBe('income_engine');
    expect(nvdy.leverage).toBe(1);
    // NVDY's overlap key is the underlying it writes options against.
    expect(nvdy.exposure).toBe('nvda');
  });

  it('weights positions against total value including cash', () => {
    const views = buildPositionViews(twoAccountSnapshot({ rhCash: 100 }));
    const total = 7.9 * NVDY_PRICE + 11 * YMAG_PRICE + 100;
    const nvdy = views.find((v) => v.symbol === 'NVDY')!;
    expect(nvdy.weight).toBeCloseTo((7.9 * NVDY_PRICE) / total, 10);
    expect(views.reduce((acc, v) => acc + v.weight, 0)).toBeLessThan(1);
  });

  it('drops holdings whose account is missing rather than inventing one', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'NVDY', 1, 10), makeHolding('ghost', 'YMAG', 1, 10)],
      quotes: quotesFor({ NVDY: 10, YMAG: 10 }),
    });
    expect(buildPositionViews(snapshot).map((v) => v.symbol)).toEqual(['NVDY']);
  });

  it('prices an unquoted holding at zero instead of guessing a value', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'NVDY', 7.9, 12)],
      quotes: {},
    });
    const [view] = buildPositionViews(snapshot);
    expect(view.price).toBe(0);
    expect(view.marketValue).toBe(0);
    expect(view.unrealizedPL).toBeCloseTo(-94.8, 6);
  });

  it('falls back to the real cost basis when no tactical basis is recorded', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [
        makeHolding('rh-1', 'SOXL', 10, 20),
        makeHolding('rh-1', 'TSMX', 10, 20, { id: 'rh-1:TSMX', tacticalCostBasisTotal: 150 }),
      ],
      quotes: quotesFor({ SOXL: 25, TSMX: 25 }),
    });
    const views = buildPositionViews(snapshot);
    expect(views.find((v) => v.symbol === 'SOXL')!.tacticalCostBasisTotal).toBe(200);
    expect(views.find((v) => v.symbol === 'TSMX')!.tacticalCostBasisTotal).toBe(150);
  });
});

describe('analyzePortfolio totals', () => {
  it('adds cash to invested value and reports unrealised P/L', () => {
    const analysis = analyzePortfolio(twoAccountSnapshot({ rhCash: 250, schCash: 750 }), DEFAULT_STRATEGY_CONFIG);
    const invested = 7.9 * NVDY_PRICE + 11 * YMAG_PRICE;
    expect(analysis.totals.totalInvested).toBeCloseTo(invested, 8);
    expect(analysis.totals.totalCash).toBe(1000);
    expect(analysis.totals.totalValue).toBeCloseTo(invested + 1000, 8);
    expect(analysis.totals.totalCostBasis).toBeCloseTo(94.8 + 126.5, 8);
    expect(analysis.totals.unrealizedPL).toBeCloseTo(invested - 221.3, 8);
  });

  it('keeps the household reserve out of brokerage cash entirely', () => {
    // $1,000 of broker cash against the default $10,000 HOUSEHOLD target. The
    // old model reserved the broker cash and reported $0 investable, which
    // silently froze the strategy. The target lives outside the brokerages, so
    // every dollar of eligible broker cash stays deployable.
    const analysis = analyzePortfolio(twoAccountSnapshot({ schCash: 1_000 }), DEFAULT_STRATEGY_CONFIG);
    expect(analysis.totals.brokerCash).toBe(1_000);
    expect(analysis.totals.deployableBrokerCash).toBe(1_000);
    expect(analysis.totals.brokerCashFloorHeld).toBe(0);
    // …and the shortfall is still reported, loudly, as a household figure.
    expect(analysis.totals.externalLiquidityTarget).toBe(10_000);
    expect(analysis.totals.externalLiquidityCurrent).toBe(0);
    expect(analysis.totals.externalLiquidityGap).toBe(10_000);
    expect(analysis.totals.externalReserveUnderfunded).toBe(true);
  });

  it('reports the reserve as funded once the household holds the target', () => {
    const analysis = analyzePortfolio(twoAccountSnapshot({ schCash: 1_000 }), {
      ...DEFAULT_STRATEGY_CONFIG,
      externalLiquidityCurrent: 10_000,
    });
    expect(analysis.totals.externalLiquidityGap).toBe(0);
    expect(analysis.totals.externalReserveUnderfunded).toBe(false);
    expect(analysis.totals.deployableBrokerCash).toBe(1_000);
  });

  it('withholds only the settlement floor from brokerage cash, and clamps negatives', () => {
    const snapshot = twoAccountSnapshot({ schCash: 4_000 });
    const floored = analyzePortfolio(snapshot, { ...DEFAULT_STRATEGY_CONFIG, brokerCashFloor: 250 });
    expect(floored.totals.brokerCashFloorHeld).toBe(250);
    expect(floored.totals.deployableBrokerCash).toBe(3_750);
    // A floor larger than the cash on hand takes the cash, never more.
    const oversized = analyzePortfolio(snapshot, { ...DEFAULT_STRATEGY_CONFIG, brokerCashFloor: 9_000 });
    expect(oversized.totals.brokerCashFloorHeld).toBe(4_000);
    expect(oversized.totals.deployableBrokerCash).toBe(0);
    const negative = analyzePortfolio(snapshot, {
      ...DEFAULT_STRATEGY_CONFIG,
      brokerCashFloor: -500,
      externalLiquidityTarget: -5_000,
    });
    expect(negative.totals.brokerCashFloorHeld).toBe(0);
    expect(negative.totals.deployableBrokerCash).toBe(4_000);
    expect(negative.totals.externalLiquidityTarget).toBe(0);
    expect(negative.totals.externalReserveUnderfunded).toBe(false);
  });

  it('returns null P/L percent when there is no cost basis', () => {
    const empty = analyzePortfolio(makeSnapshot({ accounts: [makeAccount('rh-1', { cash: 500 })] }), DEFAULT_STRATEGY_CONFIG);
    expect(empty.totals.unrealizedPLPct).toBeNull();
    expect(empty.totals.totalValue).toBe(500);
    expect(empty.positions).toEqual([]);
  });
});

describe('analyzePortfolio rollups', () => {
  it('rolls up each account separately', () => {
    const analysis = analyzePortfolio(twoAccountSnapshot({ rhCash: 100 }), DEFAULT_STRATEGY_CONFIG);
    const rh = analysis.accounts.find((a) => a.account.id === 'rh-1')!;
    expect(rh.positionCount).toBe(1);
    expect(rh.positionsValue).toBeCloseTo(7.9 * NVDY_PRICE, 8);
    expect(rh.totalValue).toBeCloseTo(7.9 * NVDY_PRICE + 100, 8);
    expect(rh.unrealizedPLPct).toBeCloseTo((7.9 * NVDY_PRICE - 94.8) / 94.8, 8);
  });

  it('reports the cash sleeve even when no position occupies it', () => {
    const analysis = analyzePortfolio(twoAccountSnapshot({ schCash: 500 }), DEFAULT_STRATEGY_CONFIG);
    const cash = analysis.sleeves.find((s) => s.sleeve === 'cash')!;
    expect(cash.marketValue).toBe(500);
    expect(analysis.sleeves.map((s) => s.sleeve)).toEqual(['income_engine', 'cash']);
  });

  it('flags a sleeve above its configured ceiling', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1', { cash: 100 })],
      holdings: [makeHolding('rh-1', 'SOXL', 10, 20)],
      quotes: quotesFor({ SOXL: 30 }),
    });
    const analysis = analyzePortfolio(snapshot, DEFAULT_STRATEGY_CONFIG);
    const tactical = analysis.sleeves.find((s) => s.sleeve === 'tactical_leveraged')!;
    // $300 of SOXL against $400 total is 75%, far above the 10% ceiling.
    expect(tactical.ceiling).toBe(0.1);
    expect(tactical.overCeiling).toBe(true);
    expect(analysis.leveragedValue).toBe(300);
    expect(analysis.leveragedPct).toBeCloseTo(0.75, 10);
  });

  it('groups underlying exposure so overlap is visible across tickers', () => {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'NVDY', 8, 12), makeHolding('rh-1', 'NVDA', 1, 100)],
      quotes: quotesFor({ NVDY: 12.5, NVDA: 100 }),
    });
    const analysis = analyzePortfolio(snapshot, DEFAULT_STRATEGY_CONFIG);
    const nvda = analysis.exposures.find((e) => e.exposure === 'nvda')!;
    expect(nvda.symbols.sort()).toEqual(['NVDA', 'NVDY']);
    expect(nvda.marketValue).toBeCloseTo(200, 8);
    expect(nvda.weight).toBeCloseTo(1, 8);
    expect(exposureWeights(analysis).nvda).toBeCloseTo(1, 8);
  });

  it('lists positions above the single-position ceiling', () => {
    const analysis = analyzePortfolio(twoAccountSnapshot(), DEFAULT_STRATEGY_CONFIG);
    // Two positions of roughly half the portfolio each, versus a 35% limit.
    expect(analysis.concentrationBreaches.map((b) => b.symbol).sort()).toEqual(['NVDY', 'YMAG']);
    expect(analysis.concentrationBreaches[0].limit).toBe(0.35);
  });

  it('carries provenance through so the UI cannot mislabel fixture data', () => {
    const analysis = analyzePortfolio(twoAccountSnapshot(), DEFAULT_STRATEGY_CONFIG);
    expect(analysis.containsMockData).toBe(true);
    expect(analysis.asOf).toBe(AS_OF);
    expect(analysis.incomeEngineCapital).toBeCloseTo(7.9 * NVDY_PRICE + 11 * YMAG_PRICE, 8);
    expect(analysis.incomeEnginePct).toBeCloseTo(1, 8);
  });
});
