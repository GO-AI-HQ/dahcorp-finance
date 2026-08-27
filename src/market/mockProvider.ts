import type { DistributionEvent, DistributionFrequency, PriceBar, Quote } from '../core/types.js';
import { addDays, parseISODate, toISODate } from '../core/dates.js';
import { getInstrumentOrFallback } from '../core/universe.js';
import { ANCHORS_BY_SYMBOL, FIXTURE_ANCHORS, type FixtureAnchor } from '../data/fixtures.js';
import type { MarketDataProvider } from './provider.js';

/**
 * Deterministic mock market-data provider.
 *
 * Values are generated from a seeded PRNG keyed on the symbol and the snapshot
 * date, so the dataset is stable within a day (charts do not jitter between
 * requests) but moves day to day. Every quote it returns carries
 * `dataQuality: 'mock'`, which propagates through the whole application and is
 * displayed to the user.
 */

/** 32-bit string hash — stable across runtimes. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, adequate for fixture generation. */
function makeRng(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal draw from a uniform generator. */
function normal(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Generate a daily close series ending exactly at the anchor price.
 *
 * The path is a geometric random walk with the anchor's drift and volatility,
 * then rescaled so the last close equals the anchor. Rescaling keeps the quote
 * and the chart consistent, which matters because the app derives trend signals
 * from this series.
 */
function generatePath(anchor: FixtureAnchor, asOf: string, days: number): PriceBar[] {
  const rng = makeRng(`${anchor.symbol}:${asOf}:path`);
  const dailyDrift = Math.log(1 + anchor.drift52w) / TRADING_DAYS_PER_YEAR;
  const dailyVol = anchor.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);

  const logs: number[] = [0];
  for (let i = 1; i < days; i++) {
    logs.push(logs[i - 1] + dailyDrift + dailyVol * normal(rng));
  }

  const finalLog = logs[logs.length - 1];
  const bars: PriceBar[] = [];
  let cursor = parseISODate(asOf);
  // Walk backwards over weekdays so the series looks like trading sessions.
  const dates: string[] = [];
  while (dates.length < days) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(toISODate(cursor));
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  dates.reverse();

  for (let i = 0; i < days; i++) {
    // Rescale so log(price_last) - log(price_i) matches the generated path and
    // the final value is exactly the anchor price.
    const close = anchor.price * Math.exp(logs[i] - finalLog);
    bars.push({ date: dates[i], close: Math.max(0.01, Number(close.toFixed(4))) });
  }
  return bars;
}

const PAYMENTS_PER_YEAR: Record<DistributionFrequency, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
  irregular: 0,
};

/** Generate a distribution history at the instrument's declared cadence. */
function generateDistributions(anchor: FixtureAnchor, asOf: string, days: number): DistributionEvent[] {
  if (!anchor.distribution || anchor.distribution <= 0) return [];
  const instrument = getInstrumentOrFallback(anchor.symbol);
  const frequency = instrument.distributionFrequency;
  const perYear = PAYMENTS_PER_YEAR[frequency];
  if (perYear === 0) return [];

  const intervalDays = Math.round(365 / perYear);
  const count = Math.floor(days / intervalDays);
  const rng = makeRng(`${anchor.symbol}:${asOf}:dist`);
  const drift = anchor.distributionDrift ?? 0;
  const events: DistributionEvent[] = [];

  for (let i = count - 1; i >= 0; i--) {
    // i = 0 is the most recent payment.
    const payDate = addDays(asOf, -i * intervalDays - 2);
    const yearsAgo = (i * intervalDays) / 365;
    // Trend: apply the drift backwards so older payments were larger when the
    // drift is negative.
    const trendFactor = Math.pow(1 + drift, -yearsAgo);
    const noise = 1 + normal(rng) * 0.12;
    const amount = Math.max(0.0001, anchor.distribution * trendFactor * noise);
    const roc = anchor.returnOfCapitalPct;
    events.push({
      symbol: anchor.symbol,
      exDate: addDays(payDate, -2),
      payDate,
      amountPerShare: Number(amount.toFixed(4)),
      kind: roc != null && roc > 0.5 ? 'distribution' : instrument.assetClass === 'equity' ? 'dividend' : 'distribution',
      returnOfCapitalPct: roc,
      frequency,
      dataQuality: 'mock',
    });
  }
  return events;
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = 'mock-fixture';
  readonly isMock = true;

  /** Cache per (asOf, days) so a single request generates each path once. */
  private pathCache = new Map<string, PriceBar[]>();

  private pathFor(symbol: string, asOf: string, days: number): PriceBar[] {
    const anchor = ANCHORS_BY_SYMBOL.get(symbol.toUpperCase());
    if (!anchor) return [];
    const key = `${symbol.toUpperCase()}:${asOf}:${days}`;
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    const bars = generatePath(anchor, asOf, days);
    this.pathCache.set(key, bars);
    return bars;
  }

  async getQuotes(symbols: string[], asOf: string): Promise<Record<string, Quote>> {
    const out: Record<string, Quote> = {};
    for (const raw of symbols) {
      const symbol = raw.toUpperCase();
      const anchor = ANCHORS_BY_SYMBOL.get(symbol);
      if (!anchor) continue;
      const bars = this.pathFor(symbol, asOf, 300);
      const price = anchor.price;
      const previousClose = bars.at(-2)?.close ?? price;
      const closes = bars.map((b) => b.close);
      out[symbol] = {
        symbol,
        price,
        previousClose,
        dayChangePct: previousClose > 0 ? price / previousClose - 1 : 0,
        bid: Number((price * (1 - anchor.halfSpread)).toFixed(4)),
        ask: Number((price * (1 + anchor.halfSpread)).toFixed(4)),
        avgVolume: anchor.avgVolume,
        high52w: closes.length ? Math.max(...closes.slice(-252)) : price,
        low52w: closes.length ? Math.min(...closes.slice(-252)) : price,
        asOf,
        dataQuality: 'mock',
      };
    }
    return out;
  }

  async getPriceHistory(symbols: string[], asOf: string, days = 300): Promise<Record<string, PriceBar[]>> {
    const out: Record<string, PriceBar[]> = {};
    for (const raw of symbols) {
      const symbol = raw.toUpperCase();
      const bars = this.pathFor(symbol, asOf, Math.max(days, 60));
      if (bars.length) out[symbol] = bars;
    }
    return out;
  }

  async getDistributions(symbols: string[], asOf: string, days = 400): Promise<DistributionEvent[]> {
    const out: DistributionEvent[] = [];
    for (const raw of symbols) {
      const anchor = ANCHORS_BY_SYMBOL.get(raw.toUpperCase());
      if (!anchor) continue;
      out.push(...generateDistributions(anchor, asOf, days));
    }
    return out;
  }

  /** Every symbol this provider can serve. */
  get universe(): string[] {
    return FIXTURE_ANCHORS.map((a) => a.symbol);
  }
}

export const mockMarketDataProvider = new MockMarketDataProvider();
