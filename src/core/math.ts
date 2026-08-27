/** Small deterministic numeric helpers shared across the calculation engine. */

export const WEEKS_PER_YEAR = 52;
export const MONTHS_PER_YEAR = 12;
/** Average weeks in a calendar month — 52/12. Used for weekly → monthly. */
export const WEEKS_PER_MONTH = WEEKS_PER_YEAR / MONTHS_PER_YEAR;
export const DAYS_PER_YEAR = 365;

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Division that returns `fallback` instead of Infinity/NaN. */
export function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator === 0) return fallback;
  const out = numerator / denominator;
  return Number.isFinite(out) ? out : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  if (!isFiniteNumber(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) if (isFiniteNumber(v)) total += v;
  return total;
}

export function mean(values: number[]): number {
  const usable = values.filter(isFiniteNumber);
  return safeDiv(sum(usable), usable.length);
}

export function median(values: number[]): number {
  const usable = values.filter(isFiniteNumber).slice().sort((a, b) => a - b);
  if (usable.length === 0) return 0;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];
}

/** Population standard deviation. */
export function stdev(values: number[]): number {
  const usable = values.filter(isFiniteNumber);
  if (usable.length < 2) return 0;
  const avg = mean(usable);
  return Math.sqrt(mean(usable.map((v) => (v - avg) ** 2)));
}

/** Coefficient of variation (stdev / mean). Lower means more stable. */
export function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (avg === 0) return 0;
  return Math.abs(stdev(values) / avg);
}

/**
 * Ordinary least squares slope of `values` against their index.
 * Positive slope means the series is trending up.
 */
export function linearSlope(values: number[]): number {
  const usable = values.filter(isFiniteNumber);
  const n = usable.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(usable);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (usable[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return safeDiv(num, den);
}

/** Pearson correlation of two equal-length series. Returns 0 when undefined. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const xm = mean(x);
  const ym = mean(y);
  let num = 0;
  let xd = 0;
  let yd = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - xm) * (y[i] - ym);
    xd += (x[i] - xm) ** 2;
    yd += (y[i] - ym) ** 2;
  }
  const den = Math.sqrt(xd * yd);
  return den === 0 ? 0 : clamp(num / den, -1, 1);
}

/** Period-over-period simple returns from a price series. */
export function simpleReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) out.push(closes[i] / closes[i - 1] - 1);
  }
  return out;
}

/** Annualised volatility from daily closes (stdev of daily returns × √252). */
export function annualisedVolatility(closes: number[], tradingDays = 252): number {
  const rets = simpleReturns(closes);
  if (rets.length < 2) return 0;
  return stdev(rets) * Math.sqrt(tradingDays);
}

/** Largest peak-to-trough decline in the series, as a positive fraction. */
export function maxDrawdown(closes: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const c of closes) {
    if (!isFiniteNumber(c)) continue;
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.max(worst, (peak - c) / peak);
  }
  return worst;
}

/** Simple moving average of the final `period` values. `null` if too short. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period || period <= 0) return null;
  return mean(closes.slice(closes.length - period));
}

/**
 * Wilder's RSI over `period` days. `null` when there is not enough history.
 * Deterministic — this is the code Claude is required to defer to.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return clamp(100 - 100 / (1 + rs), 0, 100);
}

/** Round to `dp` decimals without float drift surprises in the UI. */
export function round(value: number, dp = 2): number {
  if (!isFiniteNumber(value)) return 0;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
