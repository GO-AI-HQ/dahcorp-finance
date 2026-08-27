import type { PriceBar, Quote } from './types.js';
import type { DipReference, StrategyConfig, TrendConfig } from './config.js';
import { annualisedVolatility, correlation, maxDrawdown, rsi, safeDiv, simpleReturns, sma } from './math.js';

/**
 * Deterministic signal framework.
 *
 * Claude is explicitly not permitted to decide that an asset has "lost trend".
 * That determination is made here, in code, from configured indicator settings.
 * Claude may only interpret and narrate the output of these functions.
 */
export type TrendStatus = 'TREND_CONFIRMED' | 'TREND_WEAKENING' | 'TREND_LOST' | 'INSUFFICIENT_DATA';

export const TREND_LABELS: Record<TrendStatus, string> = {
  TREND_CONFIRMED: 'TREND CONFIRMED',
  TREND_WEAKENING: 'TREND WEAKENING',
  TREND_LOST: 'TREND LOST',
  INSUFFICIENT_DATA: 'INSUFFICIENT DATA',
};

export interface TrendCheck {
  key: string;
  label: string
  passed: boolean | null;
  value: number | null;
  threshold: number | null;
  detail: string;
}

export interface TrendSignal {
  symbol: string;
  status: TrendStatus;
  /** Count of passed / total evaluable checks. */
  passed: number;
  evaluable: number;
  checks: TrendCheck[];
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;
  drawdownFromRecentHigh: number;
  recentHigh: number | null;
  volatilityAnnualised: number | null;
  /** Relative strength vs the configured benchmark over 60 sessions. */
  relativeStrength60d: number | null;
  correlationToBenchmark: number | null;
  /** Plain-language summary suitable for the audit log. */
  summary: string;
}

function highOfLast(bars: PriceBar[], days: number): number | null {
  const slice = bars.slice(-days);
  if (!slice.length) return null;
  return Math.max(...slice.map((b) => b.close));
}

function returnOverDays(bars: PriceBar[], days: number): number | null {
  if (bars.length < days + 1) {
    if (bars.length < 2) return null;
    const first = bars[0].close;
    const last = bars.at(-1)!.close;
    return first > 0 ? last / first - 1 : null;
  }
  const first = bars[bars.length - 1 - days].close;
  const last = bars.at(-1)!.close;
  return first > 0 ? last / first - 1 : null;
}

export function computeTrendSignal(args: {
  symbol: string;
  bars: PriceBar[];
  quote: Quote;
  config: TrendConfig;
  benchmarkBars?: PriceBar[];
  /** Recent volume vs its own average, as a ratio. Optional. */
  volumeRatio?: number | null;
}): TrendSignal {
  const { symbol, bars, quote, config } = args;
  const closes = bars.map((b) => b.close);
  const price = quote.price || closes.at(-1) || 0;

  const sma20 = sma(closes, config.shortMaDays);
  const sma50 = sma(closes, config.mediumMaDays);
  const sma200 = sma(closes, config.longMaDays);
  const rsiValue = rsi(closes, config.rsiPeriod);
  const recentHigh = highOfLast(bars, 60);
  const drawdownFromRecentHigh = recentHigh && recentHigh > 0 ? Math.max(0, (recentHigh - price) / recentHigh) : 0;
  const volatilityAnnualised = closes.length > 20 ? annualisedVolatility(closes) : null;

  const own60 = returnOverDays(bars, 60);
  const bench60 = args.benchmarkBars ? returnOverDays(args.benchmarkBars, 60) : null;
  const relativeStrength60d = own60 != null && bench60 != null ? own60 - bench60 : null;
  const correlationToBenchmark = args.benchmarkBars
    ? correlation(simpleReturns(closes).slice(-60), simpleReturns(args.benchmarkBars.map((b) => b.close)).slice(-60))
    : null;

  const checks: TrendCheck[] = [
    {
      key: 'price_above_sma20',
      label: `Price above ${config.shortMaDays}-day MA`,
      passed: sma20 == null ? null : price > sma20,
      value: sma20,
      threshold: price,
      detail: 'Short-term momentum intact.',
    },
    {
      key: 'price_above_sma50',
      label: `Price above ${config.mediumMaDays}-day MA`,
      passed: sma50 == null ? null : price > sma50,
      value: sma50,
      threshold: price,
      detail: 'Intermediate trend intact.',
    },
    {
      key: 'price_above_sma200',
      label: `Price above ${config.longMaDays}-day MA`,
      passed: sma200 == null ? null : price > sma200,
      value: sma200,
      threshold: price,
      detail: 'Primary trend intact.',
    },
    {
      key: 'ma_stack',
      label: `${config.shortMaDays}-day MA above ${config.mediumMaDays}-day MA`,
      passed: sma20 == null || sma50 == null ? null : sma20 > sma50,
      value: sma20,
      threshold: sma50,
      detail: 'Moving averages stacked in trend order.',
    },
    {
      key: 'rsi_not_weak',
      label: `RSI(${config.rsiPeriod}) above ${config.rsiWeakBelow}`,
      passed: rsiValue == null ? null : rsiValue >= config.rsiWeakBelow,
      value: rsiValue,
      threshold: config.rsiWeakBelow,
      detail: 'Momentum has not broken down.',
    },
    {
      key: 'drawdown',
      label: `Drawdown from 60-day high under ${(config.drawdownWarnPct * 100).toFixed(0)}%`,
      passed: recentHigh == null ? null : drawdownFromRecentHigh < config.drawdownWarnPct,
      value: drawdownFromRecentHigh,
      threshold: config.drawdownWarnPct,
      detail: 'Price is holding near its recent high.',
    },
    {
      key: 'relative_strength',
      label: `Outperforming ${config.benchmarkSymbol} over 60 sessions`,
      passed: relativeStrength60d == null ? null : relativeStrength60d > 0,
      value: relativeStrength60d,
      threshold: 0,
      detail: 'Leadership rather than lagging participation.',
    },
  ];

  if (config.requireVolumeConfirmation) {
    checks.push({
      key: 'volume',
      label: 'Volume at or above average',
      passed: args.volumeRatio == null ? null : args.volumeRatio >= 1,
      value: args.volumeRatio ?? null,
      threshold: 1,
      detail: 'Participation confirms the move.',
    });
  }

  const evaluable = checks.filter((c) => c.passed !== null).length;
  const passed = checks.filter((c) => c.passed === true).length;

  let status: TrendStatus;
  if (evaluable < 3) {
    status = 'INSUFFICIENT_DATA';
  } else if (drawdownFromRecentHigh >= config.drawdownBreakPct) {
    // A break beyond the configured drawdown threshold is decisive regardless
    // of how the other checks read.
    status = 'TREND_LOST';
  } else if (sma50 != null && price < sma50 && (sma200 == null || price < sma200)) {
    status = 'TREND_LOST';
  } else {
    const ratio = safeDiv(passed, evaluable);
    status = ratio >= 0.7 ? 'TREND_CONFIRMED' : ratio >= 0.45 ? 'TREND_WEAKENING' : 'TREND_LOST';
  }

  const summaryParts = [`${passed}/${evaluable} checks passed`];
  if (recentHigh) summaryParts.push(`${(drawdownFromRecentHigh * 100).toFixed(1)}% below 60-day high`);
  if (rsiValue != null) summaryParts.push(`RSI ${rsiValue.toFixed(0)}`);
  if (relativeStrength60d != null) summaryParts.push(`${relativeStrength60d >= 0 ? '+' : ''}${(relativeStrength60d * 100).toFixed(1)}% vs ${config.benchmarkSymbol}`);

  return {
    symbol: symbol.toUpperCase(),
    status,
    passed,
    evaluable,
    checks,
    price,
    sma20,
    sma50,
    sma200,
    rsi: rsiValue,
    drawdownFromRecentHigh,
    recentHigh,
    volatilityAnnualised,
    relativeStrength60d,
    correlationToBenchmark,
    summary: summaryParts.join(' · '),
  };
}

/** Dip-accumulation signal for long-term assets. */
export interface DipSignal {
  symbol: string;
  reference: DipReference;
  referencePrice: number | null;
  price: number;
  /** Decline from the reference, as a positive fraction. */
  declineFromReference: number | null;
  /** The deepest configured level currently satisfied, or null. */
  levelReached: number | null;
  /** The next configured level below the current price. */
  nextLevel: number | null;
  /** Price at which the next level triggers. */
  nextLevelPrice: number | null;
  /** True when a configured dip level is met AND trend has not broken. */
  actionable: boolean;
  trendStatus: TrendStatus;
  /**
   * Explicit reasoning. A price decline alone is never treated as evidence of
   * undervaluation — trend and context are required.
   */
  rationale: string[];
}

export function computeDipSignal(args: {
  symbol: string;
  bars: PriceBar[];
  quote: Quote;
  config: StrategyConfig;
  trend: TrendSignal;
  /** Optional externally-supplied fair-value estimate. */
  fairValue?: number | null;
}): DipSignal {
  const { symbol, bars, quote, config, trend } = args;
  const closes = bars.map((b) => b.close);
  const price = quote.price || closes.at(-1) || 0;

  const referencePrice = (() => {
    switch (config.dipReference) {
      case 'recent_high_60d':
        return highOfLast(bars, 60);
      case 'high_52w':
        return quote.high52w ?? highOfLast(bars, 252);
      case 'sma50':
        return sma(closes, config.trend.mediumMaDays);
      case 'sma200':
        return sma(closes, config.trend.longMaDays);
      case 'fair_value':
        return args.fairValue ?? null;
      default:
        return null;
    }
  })();

  const declineFromReference =
    referencePrice && referencePrice > 0 ? Math.max(0, (referencePrice - price) / referencePrice) : null;

  const levels = [...config.dipLevels].sort((a, b) => a - b);
  let levelReached: number | null = null;
  let nextLevel: number | null = null;
  if (declineFromReference != null) {
    for (const level of levels) {
      if (declineFromReference >= level) levelReached = level;
      else if (nextLevel == null) nextLevel = level;
    }
  }

  const rationale: string[] = [];
  if (referencePrice == null) {
    rationale.push('No reference price available for the configured dip anchor — cannot evaluate.');
  } else {
    rationale.push(`Price is ${((declineFromReference ?? 0) * 100).toFixed(1)}% below the ${config.dipReference.replace(/_/g, ' ')} of ${referencePrice.toFixed(2)}.`);
  }
  if (levelReached == null) rationale.push('No configured dip level has been reached.');
  if (trend.status === 'TREND_LOST') rationale.push('Trend is LOST — a decline of this depth is a breakdown, not a discount. Accumulation is not signalled.');
  if (trend.status === 'TREND_WEAKENING') rationale.push('Trend is WEAKENING — size any accumulation smaller than a confirmed-trend entry.');
  if (trend.rsi != null && trend.rsi < config.trend.rsiWeakBelow) rationale.push(`RSI of ${trend.rsi.toFixed(0)} is below the configured weakness floor — momentum has not stabilised.`);
  rationale.push('A price decline is not the same as undervaluation. Confirm the long-term thesis and concentration limits before allocating.');

  return {
    symbol: symbol.toUpperCase(),
    reference: config.dipReference,
    referencePrice,
    price,
    declineFromReference,
    levelReached,
    nextLevel,
    nextLevelPrice: nextLevel != null && referencePrice ? referencePrice * (1 - nextLevel) : null,
    actionable: levelReached != null && trend.status !== 'TREND_LOST',
    trendStatus: trend.status,
    rationale,
  };
}

/** Rolling max drawdown of a position, for the leveraged sleeve display. */
export function positionDrawdown(bars: PriceBar[], lookbackDays = 252): number {
  return maxDrawdown(bars.slice(-lookbackDays).map((b) => b.close));
}
