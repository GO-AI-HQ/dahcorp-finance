import type { DistributionEvent, PriceBar, Quote } from './types.js';
import type { DistributionBasis } from './config.js';
import { annualisedVolatility, clamp, correlation, maxDrawdown, safeDiv, simpleReturns } from './math.js';
import {
  computeDistributionStats,
  forwardDistributionRate,
  priceChangeOverDays,
  totalReturnOverDays,
  type DistributionStats,
} from './distributions.js';
import { getInstrumentOrFallback } from './universe.js';

/**
 * Cash-Flow Efficiency Score.
 *
 * A deliberately multi-factor score. Advertised distribution yield is only one
 * of eleven inputs and is capped in its contribution, because ranking income
 * instruments by headline yield is the single fastest way to buy NAV erosion.
 *
 * Every component is normalised to 0-1 and combined with explicit weights, so
 * the score is auditable: the UI shows each component, not just the total.
 */
export interface EfficiencyComponent {
  key: string;
  label: string;
  /** Normalised 0-1 contribution before weighting. */
  score: number;
  weight: number;
  /** Raw underlying value, for display. */
  raw: number | null;
  /** Short explanation of what this component measured. */
  detail: string;
}

export interface CashFlowEfficiency {
  symbol: string;
  /** 0-100. Higher is a better cash-flow-per-risk-adjusted-dollar proposition. */
  score: number;
  components: EfficiencyComponent[];
  /** Distribution cash per invested dollar over each window. */
  cashPerDollar4w: number | null;
  cashPerDollar13w: number | null;
  cashPerDollar26w: number | null;
  cashPerDollar52w: number | null;
  forwardRate: number | null;
  totalReturn52w: number | null
  navChange26w: number | null;
  returnOfCapitalPct: number | null;
  stability: number;
  trend: number;
  volatility: number | null;
  drawdown52w: number | null;
  spreadPct: number | null;
  liquidityScore: number;
  /** Max correlation against current holdings' return series. */
  maxCorrelationToHoldings: number | null;
  /** Portfolio value already exposed to the same underlying, as a fraction. */
  overlapPct: number;
  /** Human-readable warnings the recommendation layer must surface. */
  warnings: string[];
  stats: DistributionStats;
}

export interface EfficiencyInput {
  symbol: string;
  quote: Quote;
  bars: PriceBar[];
  distributions: DistributionEvent[];
  asOf: string;
  basis: DistributionBasis;
  /** Return series of currently-held positions, keyed by symbol. */
  holdingReturnSeries?: Record<string, number[]>;
  /** Portfolio value already exposed to each `exposure` key, as a fraction. */
  exposureWeights?: Record<string, number>;
}

/** Normalise a value into 0-1 across [min, max], clamped. */
function norm(value: number | null, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return 0.4; // neutral-ish for unknown
  if (max === min) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

/** Normalise where lower is better. */
function normInverse(value: number | null, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return 0.4;
  return 1 - norm(value, min, max);
}

export function computeCashFlowEfficiency(input: EfficiencyInput): CashFlowEfficiency {
  const { symbol, quote, bars, distributions, asOf, basis } = input;
  const stats = computeDistributionStats(symbol, distributions, asOf);
  const price = quote.price;
  const closes = bars.map((b) => b.close);
  const instrument = getInstrumentOrFallback(symbol);

  // ── Cash per invested dollar. Price-normalised so a $12 fund and a $50 fund
  // are directly comparable, which advertised yield already does but on an
  // annualised, forward-looking, easily-gamed basis.
  const cashPerDollar = (paid: number, count: number) => (count > 0 && price > 0 ? paid / price : null);
  const cashPerDollar4w = cashPerDollar(stats.paid4w, stats.count4w);
  const cashPerDollar13w = cashPerDollar(stats.paid13w, stats.count13w);
  const cashPerDollar26w = cashPerDollar(stats.paid26w, stats.count26w);
  const cashPerDollar52w = cashPerDollar(stats.paid52w, stats.count52w);
  const forwardRate = forwardDistributionRate(stats, basis, price);

  const tr52 = totalReturnOverDays(bars, distributions.filter((d) => d.symbol === symbol), asOf, 364);
  const totalReturn52w = tr52?.totalReturn ?? null;
  const navChange26w = priceChangeOverDays(bars, asOf, 182);
  const volatility = closes.length > 20 ? annualisedVolatility(closes) : null;
  const drawdown52w = closes.length > 20 ? maxDrawdown(closes.slice(-252)) : null;

  const spreadPct =
    quote.bid != null && quote.ask != null && quote.ask > 0 && quote.bid > 0
      ? safeDiv(quote.ask - quote.bid, (quote.ask + quote.bid) / 2)
      : null;

  // Liquidity in dollars traded per day; $2M/day is treated as fully adequate
  // for the position sizes this portfolio deals in.
  const dollarVolume = quote.avgVolume != null ? quote.avgVolume * price : null;
  const liquidityScore = norm(dollarVolume, 100_000, 2_000_000);

  // ── Correlation and overlap against what is already owned.
  const candidateReturns = simpleReturns(closes).slice(-60);
  let maxCorrelationToHoldings: number | null = null;
  for (const [heldSymbol, series] of Object.entries(input.holdingReturnSeries ?? {})) {
    if (heldSymbol.toUpperCase() === symbol.toUpperCase()) continue;
    const c = correlation(candidateReturns, series.slice(-60));
    if (maxCorrelationToHoldings == null || c > maxCorrelationToHoldings) maxCorrelationToHoldings = c;
  }
  const overlapPct = input.exposureWeights?.[instrument.exposure] ?? 0;

  const components: EfficiencyComponent[] = [
    {
      key: 'cash_13w',
      label: 'Cash per dollar (13w)',
      score: norm(cashPerDollar13w, 0, 0.12),
      weight: 0.16,
      raw: cashPerDollar13w,
      detail: 'Distribution cash actually paid over 13 weeks, per dollar invested at the current price.',
    },
    {
      key: 'cash_26w',
      label: 'Cash per dollar (26w)',
      score: norm(cashPerDollar26w, 0, 0.22),
      weight: 0.1,
      raw: cashPerDollar26w,
      detail: 'Longer confirmation window — resists a single unusually large payment flattering the score.',
    },
    {
      key: 'cash_4w',
      label: 'Cash per dollar (4w)',
      score: norm(cashPerDollar4w, 0, 0.04),
      weight: 0.06,
      raw: cashPerDollar4w,
      detail: 'Most recent cadence. Lightly weighted because it is the noisiest window.',
    },
    {
      key: 'total_return',
      label: 'Total return (52w)',
      score: norm(totalReturn52w, -0.35, 0.35),
      weight: 0.18,
      raw: totalReturn52w,
      detail: 'Price change plus distributions. The only component that measures whether money was actually made.',
    },
    {
      key: 'nav_preservation',
      label: 'NAV preservation (26w)',
      score: norm(navChange26w, -0.3, 0.1),
      weight: 0.14,
      raw: navChange26w,
      detail: 'Price/NAV trajectory. Heavy erosion means distributions are partly funded by the capital base.',
    },
    {
      key: 'stability',
      label: 'Distribution stability',
      score: stats.thinHistory ? 0.35 : stats.stability,
      weight: 0.09,
      raw: stats.stability,
      detail: 'Consistency of payment size over 26 weeks. Erratic payments make income planning unreliable.',
    },
    {
      key: 'trend',
      label: 'Distribution trend',
      score: norm(stats.trend, -0.08, 0.04),
      weight: 0.06,
      raw: stats.trend,
      detail: 'Direction of payment size over the trailing window.',
    },
    {
      key: 'roc',
      label: 'Return-of-capital share',
      score: stats.returnOfCapitalPct == null ? 0.4 : normInverse(stats.returnOfCapitalPct, 0.1, 0.9),
      weight: 0.07,
      raw: stats.returnOfCapitalPct,
      detail: 'Portion of distributions classified as return of capital — the investor’s own money coming back.',
    },
    {
      key: 'drawdown',
      label: 'Drawdown resistance',
      score: normInverse(drawdown52w, 0.1, 0.6),
      weight: 0.05,
      raw: drawdown52w,
      detail: 'Worst peak-to-trough decline over the trailing year.',
    },
    {
      key: 'liquidity',
      label: 'Liquidity & spread',
      score: spreadPct == null ? liquidityScore : (liquidityScore + normInverse(spreadPct, 0.0005, 0.01)) / 2,
      weight: 0.05,
      raw: spreadPct,
      detail: 'Dollar volume and bid/ask spread — the cost of getting in and out at this size.',
    },
    {
      key: 'diversification',
      label: 'Diversification benefit',
      score: (normInverse(maxCorrelationToHoldings, 0.4, 0.95) + normInverse(overlapPct, 0.05, 0.5)) / 2,
      weight: 0.04,
      raw: maxCorrelationToHoldings,
      detail: 'Correlation to existing holdings and overlap with underlyings already owned.',
    },
  ];

  const weightTotal = components.reduce((acc, c) => acc + c.weight, 0);
  const score = clamp(
    (components.reduce((acc, c) => acc + c.score * c.weight, 0) / weightTotal) * 100,
    0,
    100,
  );

  const warnings: string[] = [];
  if (stats.thinHistory) warnings.push('Distribution history is thinner than 3 payments in 13 weeks — modeled income is low-confidence.');
  if (navChange26w != null && navChange26w < -0.15) warnings.push(`Price/NAV is down ${(navChange26w * 100).toFixed(1)}% over 26 weeks.`);
  if (totalReturn52w != null && totalReturn52w < 0) warnings.push('Negative 52-week total return: distributions have not covered NAV decline.');
  if (stats.returnOfCapitalPct != null && stats.returnOfCapitalPct > 0.6) warnings.push(`Roughly ${(stats.returnOfCapitalPct * 100).toFixed(0)}% of distributions are return of capital, not income.`);
  if (volatility != null && volatility > 0.6) warnings.push(`Annualised volatility of ${(volatility * 100).toFixed(0)}% is high for an income sleeve.`);
  if (overlapPct > 0.3) warnings.push(`Portfolio already has ${(overlapPct * 100).toFixed(0)}% exposure to ${instrument.exposure.toUpperCase()}.`);
  if (spreadPct != null && spreadPct > 0.006) warnings.push('Wide bid/ask spread relative to typical order size.');

  return {
    symbol: symbol.toUpperCase(),
    score,
    components,
    cashPerDollar4w,
    cashPerDollar13w,
    cashPerDollar26w,
    cashPerDollar52w,
    forwardRate,
    totalReturn52w,
    navChange26w,
    returnOfCapitalPct: stats.returnOfCapitalPct,
    stability: stats.stability,
    trend: stats.trend,
    volatility,
    drawdown52w,
    spreadPct,
    liquidityScore,
    maxCorrelationToHoldings,
    overlapPct,
    warnings,
    stats,
  };
}

/** Rank a set of income candidates. Never sorted by headline yield alone. */
export function rankIncomeCandidates(inputs: EfficiencyInput[]): CashFlowEfficiency[] {
  return inputs
    .map(computeCashFlowEfficiency)
    .sort((a, b) => b.score - a.score || (b.cashPerDollar13w ?? 0) - (a.cashPerDollar13w ?? 0));
}
