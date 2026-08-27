import { describe, expect, it } from 'vitest';
import type { HarvestRule } from '../src/core/config.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/core/config.js';
import { analyzePortfolio } from '../src/core/portfolio.js';
import { computeTrendSignal } from '../src/core/signals.js';
import {
  buildSemiconductorEngine,
  computeHarvestSignal,
  computeRiskReduction,
  estimateVolatilityDrag,
} from '../src/core/semiconductor.js';
import {
  barsEndingAt,
  flatBars,
  linearBars,
  makeAccount,
  makeHolding,
  makeQuote,
  makeSnapshot,
  quotesFor,
} from './helpers.js';

/**
 * Semiconductor engine: two permanent cores (TSM, SMH) plus a tactical
 * leveraged sleeve (TSMX ~2x, SOXL ~3x) that exists to be harvested into the
 * cores. Daily leverage is never treated as long-term leverage.
 */
const SOXL_RULE: HarvestRule = DEFAULT_STRATEGY_CONFIG.harvestRules.find((r) => r.symbol === 'SOXL')!;
const TSMX_RULE: HarvestRule = DEFAULT_STRATEGY_CONFIG.harvestRules.find((r) => r.symbol === 'TSMX')!;

describe('estimateVolatilityDrag', () => {
  it('applies 0.5 × L × (L−1) × σ²', () => {
    expect(estimateVolatilityDrag(3, 0.4)).toBeCloseTo(0.5 * 3 * 2 * 0.16, 12);
    expect(estimateVolatilityDrag(2, 0.4)).toBeCloseTo(0.5 * 2 * 1 * 0.16, 12);
  });

  it('grows faster than leverage itself — 3x decays more than 1.5× the 2x drag', () => {
    const twoX = estimateVolatilityDrag(2, 0.5)!;
    const threeX = estimateVolatilityDrag(3, 0.5)!;
    expect(threeX / twoX).toBeCloseTo(3, 12);
  });

  it('does not apply to unlevered holdings or unknown volatility', () => {
    expect(estimateVolatilityDrag(1, 0.4)).toBeNull();
    expect(estimateVolatilityDrag(0.5, 0.4)).toBeNull();
    expect(estimateVolatilityDrag(3, null)).toBeNull();
  });
});

describe('computeHarvestSignal', () => {
  const bars = flatBars(30, 220);
  const trend = computeTrendSignal({ symbol: 'SOXL', bars, quote: makeQuote('SOXL', 30), config: DEFAULT_STRATEGY_CONFIG.trend });

  function positionAt(symbol: string, shares: number, basisPerShare: number, price: number, tactical?: number) {
    const snapshot = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [
        makeHolding('rh-1', symbol, shares, basisPerShare, tactical != null ? { tacticalCostBasisTotal: tactical } : {}),
      ],
      quotes: quotesFor({ [symbol]: price }),
    });
    return analyzePortfolio(snapshot, DEFAULT_STRATEGY_CONFIG).positions[0];
  }

  it('arms at the configured gain and harvests the configured portion', () => {
    // 10 shares at a $24 tactical basis, now $30 — exactly +25%.
    const position = positionAt('SOXL', 10, 24, 30);
    const signal = computeHarvestSignal({ rule: SOXL_RULE, position, quote: makeQuote('SOXL', 30), trend, bars });

    expect(signal.gainPct).toBeCloseTo(0.25, 10);
    expect(signal.triggerGainPct).toBe(0.25);
    expect(signal.triggerPrice).toBeCloseTo(30, 10);
    expect(signal.progressToTrigger).toBeCloseTo(1, 10);
    expect(signal.armed).toBe(true);
    expect(signal.harvestShares).toBeCloseTo(2.5, 10);
    expect(signal.harvestProceeds).toBeCloseTo(75, 10);
    expect(signal.destinationSymbol).toBe('SMH');
    expect(signal.ruleOutcome).toContain('ARMED');
    expect(signal.ruleOutcome).toContain('→ SMH');
  });

  it('does not arm just below the trigger, and reports how far away it is', () => {
    const position = positionAt('SOXL', 10, 25, 30); // +20%
    const signal = computeHarvestSignal({ rule: SOXL_RULE, position, quote: makeQuote('SOXL', 30), trend, bars });
    expect(signal.gainPct).toBeCloseTo(0.2, 10);
    expect(signal.armed).toBe(false);
    expect(signal.harvestShares).toBe(0);
    expect(signal.harvestProceeds).toBe(0);
    expect(signal.progressToTrigger).toBeCloseTo(0.8, 10);
    expect(signal.triggerPrice).toBeCloseTo(31.25, 10);
    expect(signal.ruleOutcome).toContain('NOT ARMED');
  });

  it('uses the TSMX rule’s own +20% trigger and TSM destination', () => {
    const position = positionAt('TSMX', 5, 20, 24); // +20%
    const signal = computeHarvestSignal({ rule: TSMX_RULE, position, quote: makeQuote('TSMX', 24), trend, bars });
    expect(signal.triggerGainPct).toBe(0.2);
    expect(signal.armed).toBe(true);
    expect(signal.destinationSymbol).toBe('TSM');
    expect(signal.harvestShares).toBeCloseTo(1.25, 10);
  });

  it('measures the gain against the tactical basis, not the accounting basis', () => {
    // Accounting basis $30/share, tactical basis $200 total for 10 shares.
    const position = positionAt('SOXL', 10, 30, 30, 200);
    const signal = computeHarvestSignal({ rule: SOXL_RULE, position, quote: makeQuote('SOXL', 30), trend, bars });
    expect(signal.tacticalCostBasis).toBe(200);
    expect(signal.gainPct).toBeCloseTo(0.5, 10);
    expect(signal.armed).toBe(true);
  });

  it('is inactive when the rule is disabled', () => {
    const position = positionAt('SOXL', 10, 24, 30);
    const signal = computeHarvestSignal({
      rule: { ...SOXL_RULE, enabled: false },
      position,
      quote: makeQuote('SOXL', 30),
      trend,
      bars,
    });
    expect(signal.armed).toBe(false);
    expect(signal.ruleOutcome).toContain('Rule disabled');
  });

  it('is inactive with no position — a watchlist ticker is not an owned one', () => {
    const signal = computeHarvestSignal({ rule: SOXL_RULE, position: undefined, quote: makeQuote('SOXL', 30), trend, bars });
    expect(signal.held).toBe(false);
    expect(signal.shares).toBe(0);
    expect(signal.gainPct).toBeNull();
    expect(signal.triggerPrice).toBeNull();
    expect(signal.armed).toBe(false);
    expect(signal.ruleOutcome).toContain('No SOXL position held');
  });

  it('refuses to evaluate the trigger with no recorded basis', () => {
    const position = positionAt('SOXL', 10, 0, 30);
    const signal = computeHarvestSignal({ rule: SOXL_RULE, position, quote: makeQuote('SOXL', 30), trend, bars });
    expect(signal.gainPct).toBeNull();
    expect(signal.armed).toBe(false);
    expect(signal.ruleOutcome).toContain('cannot evaluate');
  });

  it('respects a reconfigured trigger and portion', () => {
    const position = positionAt('SOXL', 10, 24, 30);
    const signal = computeHarvestSignal({
      rule: { ...SOXL_RULE, triggerGainPct: 0.5, harvestPortionPct: 1 },
      position,
      quote: makeQuote('SOXL', 30),
      trend,
      bars,
    });
    expect(signal.armed).toBe(false);
    expect(signal.triggerPrice).toBeCloseTo(36, 10);

    const bigger = computeHarvestSignal({
      rule: { ...SOXL_RULE, triggerGainPct: 0.1, harvestPortionPct: 1 },
      position,
      quote: makeQuote('SOXL', 30),
      trend,
      bars,
    });
    expect(bigger.armed).toBe(true);
    expect(bigger.harvestShares).toBeCloseTo(10, 10);
  });
});

describe('computeRiskReduction', () => {
  const config = DEFAULT_STRATEGY_CONFIG;
  const strongTrend = computeTrendSignal({
    symbol: 'SOXL',
    bars: linearBars(20, 40, 220),
    quote: makeQuote('SOXL', 40),
    config: config.trend,
    benchmarkBars: flatBars(100, 220),
  });

  it('holds when nothing is triggered', () => {
    const signal = computeRiskReduction({ symbol: 'SOXL', trend: strongTrend, drawdown: 0.03, config, overLeverageLimit: false });
    // The strong-trend fixture is deliberately extended; RSI alone may advise
    // against adding, but nothing here recommends reducing.
    expect(signal.recommendedAction).not.toBe('reduce');
    expect(signal.recommendedAction).not.toBe('exit');
  });

  it('exits on TREND LOST, and says the deterministic framework decided', () => {
    const lost = computeTrendSignal({
      symbol: 'SOXL',
      bars: linearBars(40, 20, 220),
      quote: makeQuote('SOXL', 20),
      config: config.trend,
      benchmarkBars: flatBars(100, 220),
    });
    expect(lost.status).toBe('TREND_LOST');
    const signal = computeRiskReduction({ symbol: 'SOXL', trend: lost, drawdown: 0.5, config, overLeverageLimit: false });
    expect(signal.recommendedAction).toBe('exit');
    expect(signal.triggered).toBe(true);
    expect(signal.reasons.join(' ')).toContain('TREND LOST');
    expect(signal.detail).toContain('Phase 1 takes no action automatically.');
  });

  it('reduces on a drawdown beyond the break threshold and stops adding beyond the warning', () => {
    const reduce = computeRiskReduction({ symbol: 'SOXL', trend: strongTrend, drawdown: 0.25, config, overLeverageLimit: false });
    expect(reduce.recommendedAction).toBe('reduce');
    expect(reduce.reasons.join(' ')).toContain('exceeds the configured break threshold of 20%');

    const warn = computeRiskReduction({ symbol: 'SOXL', trend: strongTrend, drawdown: 0.15, config, overLeverageLimit: false });
    expect(warn.recommendedAction).toBe('stop_adding');
    expect(warn.reasons.join(' ')).toContain('warning threshold of 12%');
  });

  it('reduces when the leveraged sleeve is over its ceiling', () => {
    const signal = computeRiskReduction({ symbol: 'SOXL', trend: strongTrend, drawdown: 0.02, config, overLeverageLimit: true });
    expect(signal.recommendedAction).toBe('reduce');
    expect(signal.reasons.join(' ')).toContain('exceeds the configured ceiling of 10%');
  });

  it('warns against adding leverage into an extended RSI', () => {
    const signal = computeRiskReduction({ symbol: 'SOXL', trend: strongTrend, drawdown: 0.01, config, overLeverageLimit: false });
    expect(strongTrend.rsi!).toBeGreaterThan(config.trend.rsiExtendedAbove);
    expect(signal.reasons.join(' ')).toContain('above the configured extended threshold');
    expect(signal.recommendedAction).toBe('stop_adding');
  });

  it('honours reconfigured thresholds', () => {
    const loose = { ...config, trend: { ...config.trend, drawdownWarnPct: 0.3, drawdownBreakPct: 0.5, rsiExtendedAbove: 101 } };
    const signal = computeRiskReduction({ symbol: 'SOXL', trend: strongTrend, drawdown: 0.25, config: loose, overLeverageLimit: false });
    expect(signal.recommendedAction).toBe('hold');
    expect(signal.triggered).toBe(false);
    expect(signal.detail).toContain('No deterministic risk-reduction trigger');
  });
});

describe('buildSemiconductorEngine', () => {
  const config = DEFAULT_STRATEGY_CONFIG;

  const snapshot = makeSnapshot({
    accounts: [makeAccount('rh-1', { broker: 'robinhood', cash: 1_000 })],
    holdings: [
      makeHolding('rh-1', 'TSM', 2, 150),
      makeHolding('rh-1', 'SMH', 1, 240),
      makeHolding('rh-1', 'SOXL', 10, 24),
      makeHolding('rh-1', 'TSMX', 5, 25),
    ],
    quotes: quotesFor({ TSM: 180, SMH: 260, SOXL: 30, TSMX: 26 }),
    priceHistory: {
      TSM: linearBars(120, 180, 260),
      SMH: linearBars(200, 260, 260),
      SOXL: linearBars(18, 30, 260),
      TSMX: linearBars(20, 26, 260),
    },
  });

  const engine = buildSemiconductorEngine({
    analysis: analyzePortfolio(snapshot, config),
    quotes: snapshot.quotes,
    priceHistory: snapshot.priceHistory,
    config,
  });

  it('reports TSM and SMH as permanent cores with their own trend and dip signals', () => {
    expect(engine.cores.map((c) => c.symbol)).toEqual(['TSM', 'SMH']);
    for (const core of engine.cores) {
      expect(core.role).toBe('Permanent Core');
      expect(core.held).toBe(true);
      expect(core.trend.symbol).toBe(core.symbol);
      expect(core.dip.symbol).toBe(core.symbol);
    }
    const tsm = engine.cores[0];
    expect(tsm.shares).toBe(2);
    expect(tsm.marketValue).toBeCloseTo(360, 8);
    expect(tsm.unrealizedPL).toBeCloseTo(60, 8);
  });

  it('reports a core that is not held without pretending it is owned', () => {
    const empty = buildSemiconductorEngine({
      analysis: analyzePortfolio(makeSnapshot({ accounts: [makeAccount('rh-1')] }), config),
      quotes: {},
      priceHistory: {},
      config,
    });
    expect(empty.cores.every((c) => !c.held && c.shares === 0 && c.marketValue === 0)).toBe(true);
    expect(empty.cores.every((c) => c.trend.status === 'INSUFFICIENT_DATA')).toBe(true);
  });

  it('builds one tactical entry per harvest rule, with leverage from the universe', () => {
    expect(engine.tactical.map((t) => t.symbol)).toEqual(['SOXL', 'TSMX']);
    const soxl = engine.tactical.find((t) => t.symbol === 'SOXL')!;
    const tsmx = engine.tactical.find((t) => t.symbol === 'TSMX')!;
    expect(soxl.leverage).toBe(3);
    expect(tsmx.leverage).toBe(2);
    expect(soxl.destinationSymbol).toBe('SMH');
    expect(tsmx.destinationSymbol).toBe('TSM');
  });

  it('arms the SOXL leg at +25% and reports the flywheel proceeds', () => {
    const soxl = engine.tactical.find((t) => t.symbol === 'SOXL')!;
    expect(soxl.harvest.armed).toBe(true);
    expect(soxl.harvest.harvestProceeds).toBeCloseTo(75, 8);

    const leg = engine.flywheel.find((f) => f.from === 'SOXL')!;
    expect(leg).toMatchObject({ from: 'SOXL', to: 'SMH', armed: true });
    expect(leg.proceeds).toBeCloseTo(75, 8);
    expect(engine.flywheel).toHaveLength(2);
    // TSMX is +4%, well short of its +20% trigger.
    expect(engine.flywheel.find((f) => f.from === 'TSMX')!.armed).toBe(false);
  });

  it('quantifies leveraged exposure against the configured ceiling', () => {
    const { exposure } = engine;
    const total = 2 * 180 + 260 + 10 * 30 + 5 * 26 + 1_000;
    expect(exposure.leveragedValue).toBeCloseTo(300 + 130, 8);
    expect(exposure.leveragedPct).toBeCloseTo(430 / total, 8);
    expect(exposure.maxPct).toBe(0.1);
    expect(exposure.overLimit).toBe(true);
    expect(exposure.headroom).toBe(0);
    // 3x SOXL and 2x TSMX, weighted by dollars: (3×300 + 2×130) / 430.
    expect(exposure.weightedLeverage).toBeCloseTo((3 * 300 + 2 * 130) / 430, 8);
    expect(exposure.positions.map((p) => p.symbol).sort()).toEqual(['SOXL', 'TSMX']);
  });

  it('reports headroom instead of a breach when the sleeve is small', () => {
    const light = makeSnapshot({
      accounts: [makeAccount('rh-1', { cash: 10_000 })],
      holdings: [makeHolding('rh-1', 'SOXL', 10, 24)],
      quotes: quotesFor({ SOXL: 30 }),
      priceHistory: { SOXL: linearBars(18, 30, 260) },
    });
    const { exposure } = buildSemiconductorEngine({
      analysis: analyzePortfolio(light, config),
      quotes: light.quotes,
      priceHistory: light.priceHistory,
      config,
    });
    // $300 of SOXL in a $10,300 portfolio: 2.9% against a 10% ceiling.
    expect(exposure.overLimit).toBe(false);
    expect(exposure.headroom).toBeCloseTo(10_300 * 0.1 - 300, 6);
  });

  it('estimates volatility drag from the underlying, not from the levered series', () => {
    const soxl = engine.tactical.find((t) => t.symbol === 'SOXL')!;
    const leveredVol = soxl.trend.volatilityAnnualised!;
    // The 3x product's own volatility is de-levered before the drag estimate,
    // so the figure is not inflated by its own leverage.
    expect(soxl.estimatedVolatilityDrag).toBeCloseTo(estimateVolatilityDrag(3, leveredVol / 3)!, 12);
    expect(soxl.estimatedVolatilityDrag!).toBeGreaterThan(0);
  });

  it('flags every leveraged position for risk reduction when the sleeve is over its ceiling', () => {
    for (const t of engine.tactical) {
      if (!t.held) continue;
      expect(t.riskReduction.triggered).toBe(true);
      expect(t.riskReduction.reasons.join(' ')).toContain('configured ceiling');
    }
  });

  it('falls back to the last close when a quote is missing, and marks nothing as live', () => {
    const noQuotes = makeSnapshot({
      accounts: [makeAccount('rh-1')],
      holdings: [makeHolding('rh-1', 'SOXL', 10, 24)],
      quotes: {},
      priceHistory: { SOXL: barsEndingAt([28, 29, 30]) },
    });
    const built = buildSemiconductorEngine({
      analysis: analyzePortfolio(noQuotes, config),
      quotes: {},
      priceHistory: noQuotes.priceHistory,
      config,
    });
    const soxl = built.tactical.find((t) => t.symbol === 'SOXL')!;
    expect(soxl.price).toBe(30);
    // No quote means no market value in the position view — never a guess.
    expect(soxl.marketValue).toBe(0);
  });
});
