import type { DistributionEvent, PriceBar, Quote } from '../../src/core/types.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import { normalizeFmpDividendRows, type FmpDividendRow } from '../../src/market/fmpDistributions.js';
import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { intelligenceEventsByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';
import { reserveFmpCall } from './fmpDailyBudget.mts';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
export const FMP_DISTRIBUTION_CACHE_PURPOSE = 'fmp_distribution_snapshot';
const CACHE_MAX_AGE_HOURS = 24;
const MAX_ROWS_PER_SYMBOL = 100;

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

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean))];
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 180) : 'provider request failed';
}

function validFmpRows(value: unknown): FmpDividendRow[] {
  return Array.isArray(value) ? value.filter((row): row is FmpDividendRow => Boolean(row && typeof row === 'object')) : [];
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface StoredFmpSnapshot {
  symbol: string;
  fetchedAt: string;
  rows: FmpDividendRow[];
}

function snapshotFromEvent(event: IntelligenceEvent): StoredFmpSnapshot | null {
  if (event.metadata?.purpose !== FMP_DISTRIBUTION_CACHE_PURPOSE) return null;
  const symbol = typeof event.metadata.symbol === 'string' ? event.metadata.symbol.toUpperCase() : '';
  const fetchedAt = typeof event.metadata.fetchedAt === 'string' ? event.metadata.fetchedAt : event.discoveredAt;
  const rows = validFmpRows(event.metadata.rows);
  return symbol && Number.isFinite(Date.parse(fetchedAt)) ? { symbol, fetchedAt, rows } : null;
}

export async function storedFmpSnapshots(symbols: string[]): Promise<Map<string, StoredFmpSnapshot>> {
  const wanted = new Set(normalizeSymbols(symbols));
  const out = new Map<string, StoredFmpSnapshot>();
  for (const event of await intelligenceEventsByPurpose(FMP_DISTRIBUTION_CACHE_PURPOSE, 200)) {
    const snapshot = snapshotFromEvent(event);
    if (!snapshot || !wanted.has(snapshot.symbol) || out.has(snapshot.symbol)) continue;
    out.set(snapshot.symbol, snapshot);
  }
  return out;
}

function isFresh(snapshot: StoredFmpSnapshot, now = Date.now()): boolean {
  const ageMs = now - Date.parse(snapshot.fetchedAt);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= CACHE_MAX_AGE_HOURS * 3_600_000;
}

export interface FmpSymbolStatus {
  symbol: string;
  source: 'fmp' | 'cache' | 'fallback';
  rows: number;
  note: string;
}

export interface FmpDistributionResult {
  events: DistributionEvent[];
  statuses: FmpSymbolStatus[];
  callsUsed: number;
}

export class FmpProviderError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'FmpProviderError';
  }
}

export class FmpDistributionClient {
  readonly id = 'fmp-distributions';
  private readonly apiKey: string;

  constructor(private readonly env?: RuntimeEnv, private readonly fetchImpl: typeof fetch = fetch) {
    this.apiKey = envValue('FMP_API_KEY', env)?.trim() || '';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchCompanyDividends(symbol: string): Promise<FmpDividendRow[]> {
    if (!this.isConfigured()) throw new FmpProviderError('FMP dividend data is not configured.');

    const budget = await reserveFmpCall(`company-dividends:${symbol.toUpperCase()}`, this.env);
    if (!budget.available && budget.remaining <= 0) {
      throw new FmpProviderError(budget.note, 429);
    }

    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      limit: String(MAX_ROWS_PER_SYMBOL),
      apikey: this.apiKey,
    });
    const response = await this.fetchImpl(`${FMP_BASE_URL}/dividends?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const message = response.status === 429
        ? 'FMP returned HTTP 429. The provider is rate-limiting requests, so DAHCorp will stop asking FMP again in this request and use stored/OpenBB evidence instead.'
        : `FMP returned HTTP ${response.status}.`;
      throw new FmpProviderError(message, response.status);
    }
    return validFmpRows(await response.json());
  }
}

async function persistSnapshot(symbol: string, rows: FmpDividendRow[], fetchedAt: string): Promise<void> {
  const day = fetchedAt.slice(0, 10);
  const event: IntelligenceEvent = {
    fingerprint: await fingerprint(['fmp-distribution-snapshot', symbol, day]),
    occurredAt: fetchedAt,
    discoveredAt: fetchedAt,
    source: 'Financial Modeling Prep dividend history',
    sourceClass: 'market_benchmark',
    sourceUrl: 'https://financialmodelingprep.com/',
    sourceQuality: 0.92,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `${symbol} distribution history refreshed`,
    summary: `${rows.length} FMP dividend record${rows.length === 1 ? '' : 's'} stored for income modeling.`,
    symbols: [symbol],
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: {
      purpose: FMP_DISTRIBUTION_CACHE_PURPOSE,
      symbol,
      fetchedAt,
      rows: rows.slice(0, MAX_ROWS_PER_SYMBOL),
      modelingRule: 'Provider-supplied yield is retained only as source metadata. DAHCorp computes its own trailing and modeled distribution rates from cash payments and market price.',
      taxCharacter: 'UNKNOWN unless verified by issuer tax/19a evidence.',
    },
  };
  await persistIntelligenceEvents([event]);
}

/**
 * Get FMP distribution history with a persistent one-day cache. Dividend
 * declarations are low-frequency evidence, so normal page navigation should
 * almost always reuse a stored snapshot. A single HTTP 429 opens a circuit
 * breaker for the rest of this request instead of repeatedly hammering FMP.
 */
export async function getFmpDistributions(
  symbols: string[],
  asOf: string,
  days: number,
  options: { forceRefresh?: boolean; allowNetwork?: boolean; env?: RuntimeEnv; fetchImpl?: typeof fetch } = {},
): Promise<FmpDistributionResult> {
  const normalized = normalizeSymbols(symbols);
  const client = new FmpDistributionClient(options.env, options.fetchImpl ?? fetch);
  const allowNetwork = options.allowNetwork !== false;
  if (!client.isConfigured()) {
    return {
      events: [],
      callsUsed: 0,
      statuses: normalized.map((symbol) => ({ symbol, source: 'fallback', rows: 0, note: 'FMP is not configured.' })),
    };
  }

  const cached = await storedFmpSnapshots(normalized);
  const allEvents: DistributionEvent[] = [];
  const statuses: FmpSymbolStatus[] = [];
  let callsUsed = 0;
  let rateLimited = false;

  for (const symbol of normalized) {
    const stored = cached.get(symbol);
    if (!options.forceRefresh && stored && isFresh(stored)) {
      const events = normalizeFmpDividendRows(stored.rows, symbol, asOf, days);
      allEvents.push(...events);
      statuses.push({ symbol, source: 'cache', rows: events.length, note: `Verified FMP snapshot cached at ${stored.fetchedAt}.` });
      continue;
    }

    if (!allowNetwork || rateLimited) {
      if (stored) {
        const events = normalizeFmpDividendRows(stored.rows, symbol, asOf, days).map((row) => ({ ...row, dataQuality: 'stale' as const }));
        allEvents.push(...events);
        statuses.push({
          symbol,
          source: 'cache',
          rows: events.length,
          note: allowNetwork
            ? 'FMP rate-limited or hit its DAHCorp safety budget; using the last stored snapshot.'
            : 'Using the stored FMP snapshot without making a provider call.',
        });
      } else {
        statuses.push({
          symbol,
          source: 'fallback',
          rows: 0,
          note: allowNetwork
            ? 'FMP rate-limited or hit its DAHCorp safety budget and no stored snapshot is available; use the OpenBB fallback.'
            : 'No stored FMP snapshot is available; use the OpenBB fallback.',
        });
      }
      continue;
    }

    try {
      callsUsed += 1;
      const rows = await client.fetchCompanyDividends(symbol);
      const fetchedAt = new Date().toISOString();
      await persistSnapshot(symbol, rows, fetchedAt);
      const events = normalizeFmpDividendRows(rows, symbol, asOf, days);
      allEvents.push(...events);
      statuses.push({ symbol, source: 'fmp', rows: events.length, note: `FMP returned ${rows.length} company-dividend record${rows.length === 1 ? '' : 's'}.` });
    } catch (error) {
      if (error instanceof FmpProviderError && error.status === 429) rateLimited = true;
      if (stored) {
        const events = normalizeFmpDividendRows(stored.rows, symbol, asOf, days).map((row) => ({ ...row, dataQuality: 'stale' as const }));
        allEvents.push(...events);
        statuses.push({ symbol, source: 'cache', rows: events.length, note: `FMP refresh failed; using the last stored snapshot. ${safeMessage(error)}` });
      } else {
        statuses.push({ symbol, source: 'fallback', rows: 0, note: safeMessage(error) });
      }
    }
  }

  return {
    events: allEvents.sort((a, b) => a.exDate.localeCompare(b.exDate)),
    statuses,
    callsUsed,
  };
}

/**
 * Composite provider: Schwab/OpenBB keep their existing quote/history roles;
 * FMP becomes the preferred distribution source. OpenBB is queried only for
 * symbols where FMP did not provide usable distribution history.
 */
export class FmpPreferredMarketDataProvider implements MarketDataProvider {
  readonly id: string;
  readonly isMock: boolean;
  readonly sourceNotes: string[];

  constructor(private readonly base: MarketDataProvider, private readonly env?: RuntimeEnv) {
    this.id = `${base.id}+fmp-distributions`;
    this.isMock = base.isMock;
    this.sourceNotes = [
      ...(base.sourceNotes ?? []),
      'Financial Modeling Prep is the preferred distribution-history source. It supplies declared cash amounts and, when available, actual payment dates for income modeling.',
      'FMP distribution evidence is cached for 24 hours. Interactive pages read only stored FMP evidence; scheduled server jobs are the only paths allowed to spend provider calls.',
      'DAHCorp caps its own FMP usage well below the provider limit. When the safety budget is unavailable or exhausted, stored data and OpenBB remain the fallback.',
      'DAHCorp does not trust a provider headline yield as an annualized return. Trailing and modeled rates are calculated from actual distributions and current prices.',
      'Return-of-capital and tax character remain UNKNOWN unless verified by issuer tax or Section 19a evidence.',
    ];
  }

  getQuotes(symbols: string[], asOf: string): Promise<Record<string, Quote>> {
    return this.base.getQuotes(symbols, asOf);
  }

  getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>> {
    return this.base.getPriceHistory(symbols, asOf, days);
  }

  async getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]> {
    const normalized = normalizeSymbols(symbols);
    // Interactive portfolio/Income/Strategy/Agent requests are cache-only for
    // FMP. Scheduled refresh jobs own network access and fill this cache.
    const fmp = await getFmpDistributions(normalized, asOf, days, { env: this.env, allowNetwork: false });
    const fmpBySymbol = new Map<string, DistributionEvent[]>();
    for (const event of fmp.events) {
      const list = fmpBySymbol.get(event.symbol) ?? [];
      list.push(event);
      fmpBySymbol.set(event.symbol, list);
    }

    const needsFallback = normalized.filter((symbol) => !(fmpBySymbol.get(symbol)?.length));
    const fallback = needsFallback.length
      ? await this.base.getDistributions(needsFallback, asOf, days).catch(() => [] as DistributionEvent[])
      : [];

    return [
      ...fmp.events,
      ...fallback.filter((event) => !fmpBySymbol.has(event.symbol.toUpperCase())),
    ].sort((a, b) => a.exDate.localeCompare(b.exDate));
  }
}
