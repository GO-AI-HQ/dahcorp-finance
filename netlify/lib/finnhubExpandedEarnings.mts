import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import {
  ENERGY_INTELLIGENCE_SYMBOLS,
  SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
  SHIPPING_INTELLIGENCE_SYMBOLS,
  TECHNOLOGY_INTELLIGENCE_SYMBOLS,
} from '../../src/intelligence/taxonomy.js';
import { latestIntelligenceEventByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';

const PURPOSE = 'finnhub_expanded_earnings_v1';
const CACHE_HOURS = 6;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const EXCLUDED_NON_COMPANIES = new Set(['SEMI', 'SMH', 'SOXL', 'TSMX', 'URA', 'XLE', 'XLU']);

interface FinnhubEarningsRow {
  actual?: unknown;
  estimate?: unknown;
  period?: unknown;
  surprisePercent?: unknown;
  symbol?: unknown;
}

export interface ExpandedEarningsEvidence {
  symbol: string;
  quarters: number;
  averageSurprisePct: number | null;
  positiveSurpriseCount: number;
  latestPeriod: string | null;
  latestSurprisePct: number | null;
}

export interface FinnhubExpandedEarningsSnapshot {
  version: 'finnhub-expanded-earnings-v1';
  asOf: string;
  requestedSymbols: string[];
  evidence: ExpandedEarningsEvidence[];
  failedSymbols: string[];
  emptySymbols: string[];
  networkCalls: number;
  source: 'live' | 'cache' | 'unavailable';
  note: string;
}

function envValue(key: string): string | undefined {
  try {
    const value = Netlify.env.get(key);
    if (value != null) return value;
  } catch {
    // Unit-test/local runtimes may not expose Netlify.env.
  }
  return process.env[key];
}

function companySymbols(): string[] {
  return [...new Set([
    ...SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
    ...ENERGY_INTELLIGENCE_SYMBOLS,
    ...SHIPPING_INTELLIGENCE_SYMBOLS,
    ...TECHNOLOGY_INTELLIGENCE_SYMBOLS,
  ].map((symbol) => symbol.toUpperCase()))].filter((symbol) => !EXCLUDED_NON_COMPANIES.has(symbol));
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function isSnapshot(value: unknown): value is FinnhubExpandedEarningsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<FinnhubExpandedEarningsSnapshot>;
  return row.version === 'finnhub-expanded-earnings-v1'
    && typeof row.asOf === 'string'
    && Array.isArray(row.requestedSymbols)
    && Array.isArray(row.evidence)
    && Array.isArray(row.failedSymbols)
    && Array.isArray(row.emptySymbols);
}

function ageHours(asOf: string): number {
  const parsed = Date.parse(asOf);
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3_600_000) : Number.POSITIVE_INFINITY;
}

async function loadStored(): Promise<FinnhubExpandedEarningsSnapshot | null> {
  const event = await latestIntelligenceEventByPurpose(PURPOSE);
  const value = event?.metadata?.finnhubExpandedEarnings;
  return isSnapshot(value) ? value : null;
}

async function fetchOne(symbol: string, token: string): Promise<{
  symbol: string;
  state: 'ok' | 'empty' | 'failed';
  evidence: ExpandedEarningsEvidence | null;
}> {
  try {
    const query = new URLSearchParams({ symbol, limit: '4', token });
    const response = await fetch(`${FINNHUB_BASE}/stock/earnings?${query.toString()}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return { symbol, state: 'failed', evidence: null };
    const rows = await response.json() as FinnhubEarningsRow[];
    if (!Array.isArray(rows) || !rows.length) return { symbol, state: 'empty', evidence: null };
    const surprises = rows.map((row) => numberValue(row.surprisePercent)).filter((value): value is number => value != null);
    const latest = [...rows].sort((a, b) => String(b.period ?? '').localeCompare(String(a.period ?? '')))[0];
    return {
      symbol,
      state: 'ok',
      evidence: {
        symbol,
        quarters: rows.length,
        averageSurprisePct: average(surprises),
        positiveSurpriseCount: surprises.filter((value) => value > 0).length,
        latestPeriod: stringValue(latest?.period),
        latestSurprisePct: numberValue(latest?.surprisePercent),
      },
    };
  } catch {
    return { symbol, state: 'failed', evidence: null };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function persist(snapshot: FinnhubExpandedEarningsSnapshot): Promise<void> {
  const event: IntelligenceEvent = {
    fingerprint: `finnhub-expanded-earnings-${snapshot.asOf.slice(0, 13)}`,
    occurredAt: snapshot.asOf,
    discoveredAt: snapshot.asOf,
    source: 'Finnhub expanded company earnings research',
    sourceClass: 'corporate',
    sourceUrl: null,
    sourceQuality: 0.82,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `Finnhub earnings research covers ${snapshot.evidence.length} strategy companies`,
    summary: snapshot.note,
    symbols: snapshot.evidence.map((row) => row.symbol),
    latency: 'near_real_time',
    direction: 'neutral',
    severity: snapshot.failedSymbols.length ? 'medium' : 'info',
    sentimentScore: null,
    metadata: { purpose: PURPOSE, finnhubExpandedEarnings: snapshot },
  };
  await persistIntelligenceEvents([event]);
}

export async function loadFinnhubExpandedEarnings(): Promise<FinnhubExpandedEarningsSnapshot | null> {
  return loadStored();
}

/**
 * Finnhub-only expansion for company earnings history. Heavy OpenBB/SEC/FINRA
 * company lanes intentionally keep their smaller targeted universes; this
 * expands Finnhub coverage without multiplying unrelated provider fan-out.
 */
export async function refreshFinnhubExpandedEarnings(force = false): Promise<FinnhubExpandedEarningsSnapshot> {
  const stored = await loadStored();
  if (!force && stored && ageHours(stored.asOf) <= CACHE_HOURS) {
    return { ...stored, networkCalls: 0, source: 'cache' };
  }

  const token = envValue('FINNHUB_API_KEY')?.trim();
  const requestedSymbols = companySymbols();
  if (!token) {
    return stored
      ? { ...stored, networkCalls: 0, source: 'cache', note: `${stored.note} FINNHUB_API_KEY is currently unavailable, so the last verified expanded snapshot is retained.` }
      : {
          version: 'finnhub-expanded-earnings-v1',
          asOf: new Date().toISOString(),
          requestedSymbols,
          evidence: [],
          failedSymbols: requestedSymbols,
          emptySymbols: [],
          networkCalls: 0,
          source: 'unavailable',
          note: 'Finnhub expanded earnings research is unavailable because FINNHUB_API_KEY is not configured.',
        };
  }

  const rows = await mapWithConcurrency(requestedSymbols, 4, (symbol) => fetchOne(symbol, token));
  const previous = new Map((stored?.evidence ?? []).map((row) => [row.symbol, row]));
  const evidence = rows
    .map((row) => row.evidence ?? (row.state === 'failed' ? previous.get(row.symbol) ?? null : null))
    .filter((row): row is ExpandedEarningsEvidence => row != null)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const failedSymbols = rows.filter((row) => row.state === 'failed').map((row) => row.symbol);
  const emptySymbols = rows.filter((row) => row.state === 'empty').map((row) => row.symbol);
  const snapshot: FinnhubExpandedEarningsSnapshot = {
    version: 'finnhub-expanded-earnings-v1',
    asOf: new Date().toISOString(),
    requestedSymbols,
    evidence,
    failedSymbols,
    emptySymbols,
    networkCalls: requestedSymbols.length,
    source: evidence.length ? 'live' : 'unavailable',
    note: `Finnhub company earnings history now targets ${requestedSymbols.length} strategy equities rather than the original fixed eight. ${failedSymbols.length} request failure${failedSymbols.length === 1 ? '' : 's'} retained prior verified evidence when available; ${emptySymbols.length} symbol${emptySymbols.length === 1 ? '' : 's'} returned no earnings rows.`,
  };
  await persist(snapshot);
  return snapshot;
}
