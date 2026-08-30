import { createPrivateKey, randomBytes, sign as signPayload, type KeyObject } from 'node:crypto';
import type { DistributionEvent, DistributionFrequency, PriceBar, Quote } from '../../src/core/types.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import { MarketDataError } from '../../src/market/provider.js';
import type { SchwabAdapter } from '../../src/brokers/schwab/adapter.js';
import { SchwabHybridMarketDataProvider } from './schwabMarketProvider.mts';

interface OpenBBEnvelope<T> {
  results?: T[];
  provider?: string | null;
  warnings?: unknown;
}

interface OpenBBQuoteRow {
  symbol?: string;
  bid?: number | null;
  ask?: number | null;
  last_price?: number | null;
  prev_close?: number | null;
  volume?: number | null;
  volume_average?: number | null;
  year_high?: number | null;
  year_low?: number | null;
}

interface OpenBBHistoryRow {
  date?: string;
  close?: number | null;
}

interface OpenBBDividendRow {
  symbol?: string | null;
  ex_dividend_date?: string;
  amount?: number | null;
}

type RuntimeEnv = Record<string, string | undefined>;

function envValue(key: string, env?: RuntimeEnv): string | undefined {
  const explicit = env?.[key];
  if (explicit != null) return explicit;
  try {
    const netlify = (globalThis as typeof globalThis & {
      Netlify?: { env?: { get?: (name: string) => string | undefined } };
    }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean))];
}

function dateDaysBefore(asOf: string, days: number): string {
  const end = new Date(`${asOf}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - Math.max(1, days));
  return end.toISOString().slice(0, 10);
}

function inferredFrequency(dates: string[]): DistributionFrequency {
  if (dates.length < 2) return 'irregular';
  const sorted = [...dates].sort();
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const next = Date.parse(`${sorted[i]}T00:00:00Z`);
    const gap = (next - prev) / 86_400_000;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return 'irregular';
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median <= 10) return 'weekly';
  if (median <= 45) return 'monthly';
  if (median <= 120) return 'quarterly';
  if (median <= 220) return 'semiannual';
  if (median <= 450) return 'annual';
  return 'irregular';
}

/**
 * Server-only provider for the DAHCorp Cloud Run gateway.
 *
 * Netlify holds only an Ed25519 private signing key. Google contains only the
 * matching public verification key. The gateway's attached Google service
 * account then invokes the private OpenBB Cloud Run service.
 */
export class OpenBBGatewayMarketDataProvider implements MarketDataProvider {
  readonly id = 'openbb-cloud-run-gateway';
  readonly isMock = false;
  readonly sourceNotes = [
    'OpenBB market evidence is retrieved through the DAHCorp signed Google Cloud gateway using the yfinance provider.',
    'OpenBB/yfinance dividend history supplies ex-dividend date and cash amount but not verified payment date or tax character; payment date is represented by ex-date for model timing and ROC remains UNKNOWN.',
    'OpenBB/yfinance data is treated as delayed market evidence, not exchange-native execution pricing.',
  ];

  private readonly baseUrl: string;
  private readonly signingKeyValue: string;
  private readonly provider: string;
  private signingKey: KeyObject | null = null;

  constructor(env?: RuntimeEnv, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = (envValue('OPENBB_GATEWAY_URL', env)?.trim() || '').replace(/\/$/, '');
    this.signingKeyValue = envValue('OPENBB_GATEWAY_SIGNING_KEY', env)?.trim() || '';
    this.provider = envValue('OPENBB_MARKET_PROVIDER', env)?.trim().toLowerCase() || 'yfinance';
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.signingKeyValue);
  }

  private privateKey(): KeyObject {
    if (this.signingKey) return this.signingKey;
    try {
      this.signingKey = createPrivateKey({
        key: Buffer.from(this.signingKeyValue, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      return this.signingKey;
    } catch (cause) {
      throw new MarketDataError('OpenBB gateway signing key is invalid.', this.id, cause);
    }
  }

  private signedHeaders(path: string, query: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(18).toString('base64url');
    const canonical = ['GET', path, query, timestamp, nonce].join('\n');
    const signature = signPayload(null, Buffer.from(canonical, 'utf8'), this.privateKey()).toString('base64url');
    return {
      Accept: 'application/json',
      'X-DAHCORP-TIMESTAMP': timestamp,
      'X-DAHCORP-NONCE': nonce,
      'X-DAHCORP-SIGNATURE': signature,
    };
  }

  private async get<T>(path: string, params: URLSearchParams): Promise<OpenBBEnvelope<T>> {
    if (!this.isConfigured()) throw new MarketDataError('OpenBB gateway is not configured.', this.id);
    params.set('provider', this.provider);
    const query = params.toString();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}?${query}`, {
        headers: this.signedHeaders(path, query),
      });
    } catch (cause) {
      throw new MarketDataError('OpenBB gateway could not be reached.', this.id, cause);
    }
    if (!response.ok) {
      throw new MarketDataError(`OpenBB gateway returned HTTP ${response.status}.`, this.id);
    }
    try {
      return (await response.json()) as OpenBBEnvelope<T>;
    } catch (cause) {
      throw new MarketDataError('OpenBB gateway returned invalid JSON.', this.id, cause);
    }
  }

  async getQuotes(symbols: string[], _asOf: string): Promise<Record<string, Quote>> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return {};
    const payload = await this.get<OpenBBQuoteRow>('/v1/quote', new URLSearchParams({ symbol: normalized.join(',') }));
    const now = new Date().toISOString();
    const out: Record<string, Quote> = {};
    for (const row of payload.results ?? []) {
      const symbol = row.symbol?.toUpperCase();
      const price = finite(row.last_price);
      if (!symbol || price == null || price <= 0) continue;
      const previousClose = finite(row.prev_close) ?? price;
      out[symbol] = {
        symbol,
        price,
        previousClose,
        dayChangePct: previousClose > 0 ? price / previousClose - 1 : 0,
        bid: finite(row.bid) ?? undefined,
        ask: finite(row.ask) ?? undefined,
        avgVolume: finite(row.volume_average) ?? finite(row.volume) ?? undefined,
        high52w: finite(row.year_high) ?? undefined,
        low52w: finite(row.year_low) ?? undefined,
        asOf: now,
        dataQuality: 'delayed',
      };
    }
    return out;
  }

  async getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>> {
    const normalized = normalizeSymbols(symbols);
    const startDate = dateDaysBefore(asOf, Math.max(days * 2, days + 30));
    const entries = await Promise.all(normalized.map(async (symbol) => {
      const payload = await this.get<OpenBBHistoryRow>('/v1/history', new URLSearchParams({
        symbol,
        start_date: startDate,
        end_date: asOf,
      }));
      const bars = (payload.results ?? [])
        .map((row) => {
          const close = finite(row.close);
          const date = typeof row.date === 'string' ? row.date.slice(0, 10) : '';
          return close != null && close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, close } : null;
        })
        .filter((bar): bar is PriceBar => bar != null)
        .sort((a, b) => a.date.localeCompare(b.date));
      return [symbol, bars.slice(-Math.max(days, 60))] as const;
    }));
    return Object.fromEntries(entries);
  }

  async getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]> {
    const normalized = normalizeSymbols(symbols);
    const startDate = dateDaysBefore(asOf, days);
    const rows = await Promise.all(normalized.map(async (symbol) => {
      const payload = await this.get<OpenBBDividendRow>('/v1/dividends', new URLSearchParams({
        symbol,
        start_date: startDate,
        end_date: asOf,
      }));
      return (payload.results ?? []).map((row) => ({ symbol, row }));
    }));

    const flat = rows.flat();
    const datesBySymbol = new Map<string, string[]>();
    for (const { symbol, row } of flat) {
      const exDate = typeof row.ex_dividend_date === 'string' ? row.ex_dividend_date.slice(0, 10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(exDate)) {
        const list = datesBySymbol.get(symbol) ?? [];
        list.push(exDate);
        datesBySymbol.set(symbol, list);
      }
    }

    const out: DistributionEvent[] = [];
    for (const { symbol, row } of flat) {
      const exDate = typeof row.ex_dividend_date === 'string' ? row.ex_dividend_date.slice(0, 10) : '';
      const amount = finite(row.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate) || amount == null || amount <= 0) continue;
      out.push({
        symbol: row.symbol?.toUpperCase() || symbol,
        exDate,
        payDate: exDate,
        amountPerShare: amount,
        kind: 'dividend',
        frequency: inferredFrequency(datesBySymbol.get(symbol) ?? []),
        dataQuality: 'delayed',
      });
    }
    return out.sort((a, b) => a.exDate.localeCompare(b.exDate));
  }
}

/** Schwab remains preferred for execution-adjacent quotes; OpenBB owns history/dividends. */
export class SchwabOpenBBMarketDataProvider implements MarketDataProvider {
  readonly id = 'schwab-openbb-production';
  readonly isMock = false;
  readonly sourceNotes: string[];
  private readonly schwabProvider: SchwabHybridMarketDataProvider;

  constructor(
    schwab: SchwabAdapter,
    private readonly openbb: OpenBBGatewayMarketDataProvider,
    env: NodeJS.ProcessEnv = process.env,
    historySymbols: string[] = [],
  ) {
    this.schwabProvider = new SchwabHybridMarketDataProvider(schwab, env, historySymbols);
    this.sourceNotes = [
      'Current quotes prefer Schwab Market Data Production and fall back to OpenBB/yfinance only when Schwab does not return a usable symbol.',
      ...openbb.sourceNotes,
    ];
  }

  async getQuotes(symbols: string[], asOf: string): Promise<Record<string, Quote>> {
    const schwab = await this.schwabProvider.getQuotes(symbols, asOf);
    const missing = normalizeSymbols(symbols).filter((symbol) => schwab[symbol]?.dataQuality !== 'live');
    if (!missing.length) return schwab;
    const openbb = await this.openbb.getQuotes(missing, asOf);
    return { ...schwab, ...openbb };
  }

  getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>> {
    return this.openbb.getPriceHistory(symbols, asOf, days);
  }

  getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]> {
    return this.openbb.getDistributions(symbols, asOf, days);
  }
}
