import { describe, expect, it } from 'vitest';
import { DEFAULT_STRATEGY_CONFIG } from '../src/core/config.js';
import {
  TREND_LABELS,
  computeDipSignal,
  computeTrendSignal,
  positionDrawdown,
} from '../src/core/signals.js';
import { barsEndingAt, flatBars, linearBars, makeQuote } from './helpers.js';

/**
 * Trend and dip determination. The plan is explicit that Claude may not decide
 * an asset has "lost trend" — these deterministic functions decide, and Claude
 * may only narrate them. So the tests pin the state machine, not the prose.
 */
const trendConfig = DEFAULT_STRATEGY_CONFIG.trend;

function trendFor(closes: number[], price: number, benchmark = flatBars(100, 220)) {
  const bars = barsEndingAt(closes);
  return computeTrendSignal({
    symbol: 'smh',
    bars,
    quote: makeQuote('SMH', price),
    config: trendConfig,
    benchmarkBars: benchmark,
  });
}

describe('computeTrendSignal', () => {
  it('confirms a clean uptrend and reports the indicator values it used', () => {
    const bars = linearBars(50, 100, 220);
    const trend = computeTrendSignal({
      symbol: 'smh',
      bars,
      quote: makeQuote('SMH', 100),
      config: trendConfig,
      benchmarkBars: flatBars(100, 220),
    });

    expect(trend.symbol).toBe('SMH');
    expect(trend.status).toBe('TREND_CONFIRMED');
    expect(trend.evaluable).toBe(7);
    expect(trend.passed).toBe(7);
    expect(trend.sma20).not.toBeNull();
    expect(trend.sma50).not.toBeNull();
    expect(trend.sma200).not.toBeNull();
    expect(trend.price).toBeGreaterThan(trend.sma20!);
    expect(trend.sma20!).toBeGreaterThan(trend.sma50!);
    expect(trend.rsi).toBe(100);
    expect(trend.drawdownFromRecentHigh).toBe(0);
    expect(trend.recentHigh).toBeCloseTo(100, 6);
    expect(trend.volatilityAnnualised).not.toBeNull();
    expect(trend.relativeStrength60d!).toBeGreaterThan(0);
    expect(trend.summary).toContain('7/7 checks passed');
  });

  it('breaks trend on a drawdown beyond the configured break threshold, whatever else reads well', () => {
    // Price 25% below its 60-day high, but still above every moving average.
    const closes = [...new Array(180).fill(60), ...new Array(30).fill(200), 150];
    const trend = trendFor(closes as number[], 150);
    expect(trend.drawdownFromRecentHigh).toBeCloseTo(0.25, 8);
    expect(trend.drawdownFromRecentHigh).toBeGreaterThanOrEqual(trendConfig.drawdownBreakPct);
    expect(trend.price).toBeGreaterThan(trend.sma50!);
    expect(trend.status).toBe('TREND_LOST');
  });

  it('breaks trend when price sits below both the 50- and 200-day averages', () => {
    const trend = trendFor(linearBars(100, 50, 220).map((b) => b.close), 50);
    expect(trend.price).toBeLessThan(trend.sma50!);
    expect(trend.price).toBeLessThan(trend.sma200!);
    expect(trend.status).toBe('TREND_LOST');
  });

  it('downgrades to weakening rather than lost when only some checks fail', () => {
    // Long base, sharp advance, then a 13% pullback: primary trend intact,
    // short-term momentum and drawdown checks failing.
    const closes = [...new Array(180).fill(100), ...new Array(20).fill(130), 113];
    const trend = trendFor(closes as number[], 113);
    expect(trend.status).toBe('TREND_WEAKENING');
    expect(trend.price).toBeGreaterThan(trend.sma50!);
    expect(trend.drawdownFromRecentHigh).toBeGreaterThan(trendConfig.drawdownWarnPct);
    expect(trend.drawdownFromRecentHigh).toBeLessThan(trendConfig.drawdownBreakPct);
    expect(trend.passed / trend.evaluable).toBeGreaterThanOrEqual(0.45);
    expect(trend.passed / trend.evaluable).toBeLessThan(0.7);
  });

  it('reports insufficient data instead of guessing from a short history', () => {
    const trend = computeTrendSignal({
      symbol: 'TSMX',
      bars: linearBars(10, 12, 5),
      quote: makeQuote('TSMX', 12),
      config: trendConfig,
    });
    expect(trend.status).toBe('INSUFFICIENT_DATA');
    expect(trend.evaluable).toBeLessThan(3);
    expect(trend.sma50).toBeNull();
    expect(trend.rsi).toBeNull();
    expect(trend.relativeStrength60d).toBeNull();
  });

  it('leaves benchmark-dependent checks unevaluated when no benchmark is supplied', () => {
    const bars = linearBars(50, 100, 220);
    const trend = computeTrendSignal({ symbol: 'SMH', bars, quote: makeQuote('SMH', 100), config: trendConfig });
    const relative = trend.checks.find((c) => c.key === 'relative_strength')!;
    expect(relative.passed).toBeNull();
    expect(trend.evaluable).toBe(6);
    expect(trend.correlationToBenchmark).toBeNull();
  });

  it('measures relative strength against the benchmark, not in absolute terms', () => {
    const bars = linearBars(50, 100, 220);
    const strongBenchmark = linearBars(50, 200, 220);
    const trend = computeTrendSignal({
      symbol: 'SMH',
      bars,
      quote: makeQuote('SMH', 100),
      config: trendConfig,
      benchmarkBars: strongBenchmark,
    });
    expect(trend.relativeStrength60d!).toBeLessThan(0);
    expect(trend.checks.find((c) => c.key === 'relative_strength')!.passed).toBe(false);
    expect(trend.correlationToBenchmark!).toBeGreaterThan(0.9);
  });

  it('adds a volume check only when volume confirmation is configured', () => {
    const bars = linearBars(50, 100, 220);
    const without = computeTrendSignal({ symbol: 'SMH', bars, quote: makeQuote('SMH', 100), config: trendConfig });
    expect(without.checks.some((c) => c.key === 'volume')).toBe(false);

    const config = { ...trendConfig, requireVolumeConfirmation: true };
    const thin = computeTrendSignal({
      symbol: 'SMH',
      bars,
      quote: makeQuote('SMH', 100),
      config,
      volumeRatio: 0.4,
    });
    expect(thin.checks.find((c) => c.key === 'volume')!.passed).toBe(false);

    const unknown = computeTrendSignal({ symbol: 'SMH', bars, quote: makeQuote('SMH', 100), config });
    expect(unknown.checks.find((c) => c.key === 'volume')!.passed).toBeNull();
  });

  it('honours configured indicator periods rather than fixed ones', () => {
    const bars = linearBars(50, 100, 220);
    const config = { ...trendConfig, shortMaDays: 10, mediumMaDays: 30, longMaDays: 100, rsiPeriod: 7 };
    const trend = computeTrendSignal({ symbol: 'SMH', bars, quote: makeQuote('SMH', 100), config });
    expect(trend.checks.find((c) => c.key === 'price_above_sma20')!.label).toContain('10-day');
    expect(trend.checks.find((c) => c.key === 'rsi_not_weak')!.label).toContain('RSI(7)');
    expect(trend.sma200).not.toBeNull(); // 100-day average, available at 220 bars
  });

  it('exposes human-readable status labels for the UI', () => {
    expect(TREND_LABELS.TREND_CONFIRMED).toBe('TREND CONFIRMED');
    expect(TREND_LABELS.TREND_LOST).toBe('TREND LOST');
    expect(TREND_LABELS.INSUFFICIENT_DATA).toBe('INSUFFICIENT DATA');
  });
});

describe('computeDipSignal', () => {
  const bars = linearBars(100, 88, 260);
  const quote = makeQuote('SMH', 88, { high52w: 100 });
  const trend = computeTrendSignal({ symbol: 'SMH', bars, quote, config: trendConfig });

  it('measures the decline against the configured reference and reports the deepest level met', () => {
    const dip = computeDipSignal({ symbol: 'smh', bars, quote, config: DEFAULT_STRATEGY_CONFIG, trend });
    expect(dip.symbol).toBe('SMH');
    expect(dip.reference).toBe('high_52w');
    expect(dip.referencePrice).toBe(100);
    expect(dip.declineFromReference).toBeCloseTo(0.12, 8);
    expect(dip.levelReached).toBe(0.1);
    expect(dip.nextLevel).toBe(0.15);
    expect(dip.nextLevelPrice).toBeCloseTo(85, 8);
  });

  it('reads the reference from the configured anchor', () => {
    const sma = computeDipSignal({
      symbol: 'SMH',
      bars,
      quote,
      config: { ...DEFAULT_STRATEGY_CONFIG, dipReference: 'sma50' },
      trend,
    });
    expect(sma.referencePrice).toBeCloseTo(trend.sma50!, 8);

    const recent = computeDipSignal({
      symbol: 'SMH',
      bars,
      quote,
      config: { ...DEFAULT_STRATEGY_CONFIG, dipReference: 'recent_high_60d' },
      trend,
    });
    expect(recent.referencePrice).toBeCloseTo(trend.recentHigh!, 8);
  });

  it('cannot evaluate a fair-value anchor without a supplied estimate', () => {
    const dip = computeDipSignal({
      symbol: 'SMH',
      bars,
      quote,
      config: { ...DEFAULT_STRATEGY_CONFIG, dipReference: 'fair_value' },
      trend,
    });
    expect(dip.referencePrice).toBeNull();
    expect(dip.declineFromReference).toBeNull();
    expect(dip.levelReached).toBeNull();
    expect(dip.actionable).toBe(false);
    expect(dip.rationale.join(' ')).toContain('cannot evaluate');

    const withEstimate = computeDipSignal({
      symbol: 'SMH',
      bars,
      quote,
      config: { ...DEFAULT_STRATEGY_CONFIG, dipReference: 'fair_value' },
      trend,
      fairValue: 110,
    });
    expect(withEstimate.declineFromReference).toBeCloseTo(0.2, 8);
    expect(withEstimate.levelReached).toBe(0.2);
    expect(withEstimate.nextLevel).toBeNull();
  });

  it('respects reconfigured dip levels', () => {
    const dip = computeDipSignal({
      symbol: 'SMH',
      bars,
      quote,
      config: { ...DEFAULT_STRATEGY_CONFIG, dipLevels: [0.03, 0.25] },
      trend,
    });
    expect(dip.levelReached).toBe(0.03);
    expect(dip.nextLevel).toBe(0.25);
    expect(dip.nextLevelPrice).toBeCloseTo(75, 8);
  });

  it('is not actionable when trend is lost — a decline is a breakdown, not a discount', () => {
    const brokenBars = linearBars(100, 60, 260);
    const brokenQuote = makeQuote('SOXL', 60, { high52w: 100 });
    const brokenTrend = computeTrendSignal({
      symbol: 'SOXL',
      bars: brokenBars,
      quote: brokenQuote,
      config: trendConfig,
    });
    expect(brokenTrend.status).toBe('TREND_LOST');

    const dip = computeDipSignal({
      symbol: 'SOXL',
      bars: brokenBars,
      quote: brokenQuote,
      config: DEFAULT_STRATEGY_CONFIG,
      trend: brokenTrend,
    });
    expect(dip.levelReached).toBe(0.2);
    expect(dip.actionable).toBe(false);
    expect(dip.rationale.join(' ')).toContain('breakdown, not a discount');
  });

  it('is not actionable before any configured level is reached', () => {
    const shallowQuote = makeQuote('SMH', 98, { high52w: 100 });
    const dip = computeDipSignal({
      symbol: 'SMH',
      bars,
      quote: shallowQuote,
      config: DEFAULT_STRATEGY_CONFIG,
      trend,
    });
    expect(dip.declineFromReference).toBeCloseTo(0.02, 8);
    expect(dip.levelReached).toBeNull();
    expect(dip.actionable).toBe(false);
    expect(dip.rationale.join(' ')).toContain('No configured dip level has been reached.');
  });

  it('always states that a decline is not the same as undervaluation', () => {
    const dip = computeDipSignal({ symbol: 'SMH', bars, quote, config: DEFAULT_STRATEGY_CONFIG, trend });
    expect(dip.rationale.at(-1)).toContain('A price decline is not the same as undervaluation');
  });

  it('warns when momentum is below the configured weakness floor', () => {
    const dip = computeDipSignal({ symbol: 'SMH', bars, quote, config: DEFAULT_STRATEGY_CONFIG, trend });
    if (trend.rsi != null && trend.rsi < trendConfig.rsiWeakBelow) {
      expect(dip.rationale.join(' ')).toContain('below the configured weakness floor');
    }
    expect(dip.trendStatus).toBe(trend.status);
  });
});

describe('positionDrawdown', () => {
  it('measures peak-to-trough decline over the lookback window', () => {
    const bars = barsEndingAt([100, 120, 60, 90]);
    expect(positionDrawdown(bars)).toBeCloseTo(0.5, 8);
  });

  it('ignores history outside the lookback window', () => {
    const bars = barsEndingAt([200, 50, ...new Array(10).fill(100)] as number[]);
    expect(positionDrawdown(bars, 10)).toBe(0);
    expect(positionDrawdown(bars, 12)).toBeCloseTo(0.75, 8);
  });
});
