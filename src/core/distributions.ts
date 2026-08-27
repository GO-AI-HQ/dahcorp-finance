import type { DistributionEvent, PriceBar } from './types.js';
import type { DistributionBasis } from './config.js';
import { WEEKS_PER_MONTH, MONTHS_PER_YEAR, WEEKS_PER_YEAR, coefficientOfVariation, linearSlope, mean, safeDiv, sum } from './math.js';
import { withinTrailingDays } from './dates.js';

/** Trailing-window distribution statistics for one symbol. */
export interface DistributionStats {
  symbol: string;
  asOf: string;
  frequency: DistributionEvent['frequency'];
  /** Payments per year implied by the cadence. */
  paymentsPerYear: number;
  /** Most recent declared amount per share, or null when no history. */
  latest: number | null;
  latestPayDate: string | null;
  /** Mean amount per share over each trailing window (per payment, not per week). */
  avg4w: number | null;
  avg13w: number | null;
  avg26w: number | null;
  avg52w: number | null;
  /** Total cash per share actually paid in each window. */
  paid4w: number;
  paid13w: number;
  paid26w: number;
  paid52w: number;
  /** Payment counts, so the UI can flag thin history. */
  count4w: number;
  count13w: number;
  count26w: number;
  count52w: number;
  /** 1 = perfectly steady, 0 = wildly variable. Based on 26w coefficient of variation. */
  stability: number;
  /** Per-payment trend over the trailing 26 weeks, as a fraction of the mean. */
  trend: number;
  /** Weighted-average ROC share of distributions over 52w (0-1), null if unreported. */
  returnOfCapitalPct: number | null;
  /** True when the trailing history is too thin to model responsibly. */
  thinHistory: boolean;
}

const FREQUENCY_PAYMENTS_PER_YEAR: Record<DistributionEvent['frequency'], number> = {
  weekly: WEEKS_PER_YEAR,
  monthly: MONTHS_PER_YEAR,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
  irregular: 0,
};

function windowEvents(events: DistributionEvent[], asOf: string, days: number): DistributionEvent[] {
  return events.filter((e) => withinTrailingDays(e.payDate, asOf, days));
}

/**
 * Compute trailing distribution statistics from a payment history.
 *
 * `events` may be unsorted and may contain other symbols; they are filtered and
 * sorted here. Nothing is inferred that the data does not support: windows with
 * no payments return `null` rather than a guess.
 */
export function computeDistributionStats(
  symbol: string,
  allEvents: DistributionEvent[],
  asOf: string,
): DistributionStats {
  const events = allEvents
    .filter((e) => e.symbol.toUpperCase() === symbol.toUpperCase())
    .slice()
    .sort((a, b) => a.payDate.localeCompare(b.payDate));

  const w4 = windowEvents(events, asOf, 28);
  const w13 = windowEvents(events, asOf, 91);
  const w26 = windowEvents(events, asOf, 182);
  const w52 = windowEvents(events, asOf, 364);

  const amounts = (list: DistributionEvent[]) => list.map((e) => e.amountPerShare);
  const avgOrNull = (list: DistributionEvent[]) => (list.length ? mean(amounts(list)) : null);

  const frequency = events.at(-1)?.frequency ?? 'irregular';
  const last = events.at(-1) ?? null;

  // ROC weighted by cash paid — a big ROC-heavy payment matters more than a
  // small clean one.
  const rocReported = w52.filter((e) => typeof e.returnOfCapitalPct === 'number');
  const rocDenom = sum(rocReported.map((e) => e.amountPerShare));
  const returnOfCapitalPct = rocReported.length && rocDenom > 0
    ? safeDiv(sum(rocReported.map((e) => e.amountPerShare * (e.returnOfCapitalPct ?? 0))), rocDenom)
    : null;

  const cv = w26.length >= 3 ? coefficientOfVariation(amounts(w26)) : w13.length >= 3 ? coefficientOfVariation(amounts(w13)) : 0;
  // A CV of 0.5 (payments swinging ±50% of their mean) scores 0 stability.
  const stability = w13.length < 3 ? 0.5 : Math.max(0, 1 - cv / 0.5);

  const trendSource = w26.length >= 4 ? amounts(w26) : amounts(w13);
  const trendMean = mean(trendSource);
  const trend = trendSource.length >= 4 && trendMean > 0 ? safeDiv(linearSlope(trendSource), trendMean) : 0;

  return {
    symbol: symbol.toUpperCase(),
    asOf,
    frequency,
    paymentsPerYear: FREQUENCY_PAYMENTS_PER_YEAR[frequency],
    latest: last?.amountPerShare ?? null,
    latestPayDate: last?.payDate ?? null,
    avg4w: avgOrNull(w4),
    avg13w: avgOrNull(w13),
    avg26w: avgOrNull(w26),
    avg52w: avgOrNull(w52),
    paid4w: sum(amounts(w4)),
    paid13w: sum(amounts(w13)),
    paid26w: sum(amounts(w26)),
    paid52w: sum(amounts(w52)),
    count4w: w4.length,
    count13w: w13.length,
    count26w: w26.length,
    count52w: w52.length,
    stability: Math.min(1, stability),
    trend,
    returnOfCapitalPct,
    thinHistory: w13.length < 3,
  };
}

/** The per-payment amount implied by the selected basis, with fallbacks. */
export function perPaymentForBasis(stats: DistributionStats, basis: DistributionBasis): number | null {
  const chain: Record<DistributionBasis, (number | null)[]> = {
    latest: [stats.latest, stats.avg4w, stats.avg13w],
    avg4w: [stats.avg4w, stats.avg13w, stats.latest],
    avg13w: [stats.avg13w, stats.avg4w, stats.latest],
    avg26w: [stats.avg26w, stats.avg13w, stats.avg4w, stats.latest],
    avg52w: [stats.avg52w, stats.avg26w, stats.avg13w, stats.latest],
  };
  for (const candidate of chain[basis]) {
    if (typeof candidate === 'number' && candidate > 0) return candidate;
  }
  return null;
}

/**
 * Average weekly distribution per share on the selected basis.
 *
 * Weekly payers use the per-payment amount directly. Monthly and quarterly
 * payers are converted to a weekly-equivalent so every instrument can be
 * compared on the same axis.
 */
export function weeklyEquivalentPerShare(stats: DistributionStats, basis: DistributionBasis): number | null {
  const perPayment = perPaymentForBasis(stats, basis);
  if (perPayment == null) return null;
  const perYear = stats.paymentsPerYear;
  if (perYear > 0) return safeDiv(perPayment * perYear, WEEKS_PER_YEAR, 0) || null;
  // Irregular cadence: fall back to observed cash over the longest window with
  // data, rather than assuming a schedule that does not exist.
  const observed: [number, number][] = [
    [stats.paid52w, 52],
    [stats.paid26w, 26],
    [stats.paid13w, 13],
    [stats.paid4w, 4],
  ];
  for (const [paid, weeks] of observed) {
    if (paid > 0) return paid / weeks;
  }
  return null;
}

/**
 * Monthly distribution per share.
 *
 * For weekly payers this is the relationship the investor specified:
 *   monthly_distribution_per_share = avg_weekly_distribution × 52 / 12
 */
export function monthlyPerShare(stats: DistributionStats, basis: DistributionBasis): number | null {
  const weekly = weeklyEquivalentPerShare(stats, basis);
  if (weekly == null) return null;
  return weekly * WEEKS_PER_MONTH;
}

export function annualPerShare(stats: DistributionStats, basis: DistributionBasis): number | null {
  const weekly = weeklyEquivalentPerShare(stats, basis);
  if (weekly == null) return null;
  return weekly * WEEKS_PER_YEAR;
}

/** Apply a conservative haircut (0-1) to a modeled amount. */
export function applyHaircut(value: number | null, haircut: number): number | null {
  if (value == null) return null;
  return value * (1 - Math.min(0.95, Math.max(0, haircut)));
}

/**
 * Forward distribution rate as a fraction of price — a modeled figure, not an
 * advertised yield, and explicitly not a total return.
 */
export function forwardDistributionRate(
  stats: DistributionStats,
  basis: DistributionBasis,
  price: number,
): number | null {
  const annual = annualPerShare(stats, basis);
  if (annual == null || price <= 0) return null;
  return annual / price;
}

/**
 * NAV / price change over a trailing window, as a fraction. This is the number
 * that tells you whether distributions are being funded by the fund's own
 * capital base.
 */
export function priceChangeOverDays(bars: PriceBar[], asOf: string, days: number): number | null {
  if (bars.length < 2) return null;
  const inWindow = bars.filter((b) => withinTrailingDays(b.date, asOf, days));
  const series = inWindow.length >= 2 ? inWindow : bars.slice(-2);
  const first = series[0]?.close;
  const last = series.at(-1)?.close;
  if (!first || !last || first <= 0) return null;
  return last / first - 1;
}

/**
 * Total return = price change + distributions received, per share, over a
 * window. This is the honest measure of whether the position made money.
 *
 * Distributions are added at their cash value (not reinvested) so the figure is
 * comparable across instruments regardless of DRIP settings.
 */
export function totalReturnOverDays(
  bars: PriceBar[],
  events: DistributionEvent[],
  asOf: string,
  days: number,
): { priceReturn: number; distributionReturn: number; totalReturn: number } | null {
  const inWindow = bars.filter((b) => withinTrailingDays(b.date, asOf, days));
  const series = inWindow.length >= 2 ? inWindow : bars.slice(-2);
  const start = series[0]?.close;
  const end = series.at(-1)?.close;
  if (!start || !end || start <= 0) return null;
  const cash = sum(events.filter((e) => withinTrailingDays(e.payDate, asOf, days)).map((e) => e.amountPerShare));
  const priceReturn = end / start - 1;
  const distributionReturn = cash / start;
  return { priceReturn, distributionReturn, totalReturn: priceReturn + distributionReturn };
}

/**
 * Decompose received cash into its economic parts.
 *
 * The rule this enforces: cash received is not profit. A distribution that is
 * 60% return of capital and paid out of a NAV that fell by more than the cash
 * received is a partial liquidation of the position, and is reported as such.
 */
export interface EconomicDecomposition {
  cashReceived: number;
  estimatedReturnOfCapital: number;
  estimatedIncomePortion: number;
  navChange: number;
  economicProfit: number;
  /** True when NAV erosion exceeded the cash paid over the window. */
  navErosionExceedsCash: boolean;
}

export function decomposeEconomics(args: {
  shares: number;
  startPrice: number;
  endPrice: number;
  cashPerShare: number;
  returnOfCapitalPct: number | null;
}): EconomicDecomposition {
  const { shares, startPrice, endPrice, cashPerShare, returnOfCapitalPct } = args;
  const cashReceived = shares * cashPerShare;
  const rocShare = returnOfCapitalPct ?? 0;
  const estimatedReturnOfCapital = cashReceived * rocShare;
  const navChange = shares * (endPrice - startPrice);
  return {
    cashReceived,
    estimatedReturnOfCapital,
    estimatedIncomePortion: cashReceived - estimatedReturnOfCapital,
    navChange,
    economicProfit: cashReceived + navChange,
    navErosionExceedsCash: navChange < 0 && Math.abs(navChange) > cashReceived,
  };
}
