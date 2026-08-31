import type { DistributionEvent, Holding, PriceBar, Quote } from '../../src/core/types.js';
import { distributionSymbols, snapshotSymbols } from '../../src/services/snapshot.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import {
  createDataPlaneSnapshot,
  routeFor,
  type DataPlaneProviderId,
  type SnapshotFreshness,
} from '../../src/data/dataPlane.js';
import { loadDataPlaneSnapshot, saveDataPlaneSnapshot } from './dataPlaneSnapshotStore.mts';
import {
  loadUsableMarketEvidenceSet,
  type LoadedMarketEvidence,
  type MarketEvidenceKind,
} from './marketEvidenceStore.mts';

export interface PreparedEvidenceStatus {
  symbol: string;
  providerId: string;
  observedAt: string;
  freshness: SnapshotFreshness;
  retained: boolean;
}

export interface PreparedMarketPayload {
  version: 'market-v1';
  builtAt: string;
  quotes: Record<string, Quote>;
  priceHistory: Record<string, PriceBar[]>;
  distributions: DistributionEvent[];
  evidence: {
    quotes: PreparedEvidenceStatus[];
    history: PreparedEvidenceStatus[];
    distributions: PreparedEvidenceStatus[];
  };
}

function canonicalProviders(providerIds: string[]): DataPlaneProviderId[] {
  const providers = new Set<DataPlaneProviderId>();
  for (const raw of providerIds) {
    const id = raw.toLowerCase();
    if (id.includes('schwab')) providers.add('schwab');
    if (id.includes('robinhood')) providers.add('robinhood');
    if (id.includes('openbb')) providers.add('openbb');
    if (id.includes('fmp')) providers.add('fmp');
    if (id.includes('finnhub')) providers.add('finnhub');
  }
  return [...providers];
}

function statusFrom<K extends MarketEvidenceKind>(symbol: string, loaded: LoadedMarketEvidence<K>): PreparedEvidenceStatus {
  return {
    symbol,
    providerId: loaded.evidence.providerId,
    observedAt: loaded.evidence.observedAt,
    freshness: loaded.freshness,
    retained: loaded.freshness === 'stale_usable',
  };
}

export async function rebuildPreparedMarketSnapshot(
  holdings: Holding[],
  now: Date = new Date(),
): Promise<{ payload: PreparedMarketPayload; persisted: boolean }> {
  const symbols = snapshotSymbols(holdings);
  const incomeSymbols = distributionSymbols(holdings);
  const [quotes, history, distributions] = await Promise.all([
    loadUsableMarketEvidenceSet('quote', symbols, now),
    loadUsableMarketEvidenceSet('history', symbols, now),
    loadUsableMarketEvidenceSet('distribution', incomeSymbols, now),
  ]);

  const quotePayload: Record<string, Quote> = {};
  const historyPayload: Record<string, PriceBar[]> = {};
  const distributionPayload: DistributionEvent[] = [];
  const providerIds: string[] = [];
  let containsMockData = false;

  for (const [symbol, loaded] of quotes) {
    quotePayload[symbol] = loaded.evidence.payload;
    providerIds.push(loaded.evidence.providerId);
    containsMockData ||= loaded.evidence.containsMockData;
  }
  for (const [symbol, loaded] of history) {
    historyPayload[symbol] = loaded.evidence.payload;
    providerIds.push(loaded.evidence.providerId);
    containsMockData ||= loaded.evidence.containsMockData;
  }
  for (const loaded of distributions.values()) {
    distributionPayload.push(...loaded.evidence.payload);
    providerIds.push(loaded.evidence.providerId);
    containsMockData ||= loaded.evidence.containsMockData;
  }

  const builtAt = now.toISOString();
  const payload: PreparedMarketPayload = {
    version: 'market-v1',
    builtAt,
    quotes: quotePayload,
    priceHistory: historyPayload,
    distributions: distributionPayload.sort((a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol)),
    evidence: {
      quotes: [...quotes].map(([symbol, loaded]) => statusFrom(symbol, loaded)),
      history: [...history].map(([symbol, loaded]) => statusFrom(symbol, loaded)),
      distributions: [...distributions].map(([symbol, loaded]) => statusFrom(symbol, loaded)),
    },
  };

  const retainedCount = [...payload.evidence.quotes, ...payload.evidence.history, ...payload.evidence.distributions]
    .filter((row) => row.retained).length;
  const providers = canonicalProviders(providerIds);
  const persisted = await saveDataPlaneSnapshot(createDataPlaneSnapshot({
    domain: 'market',
    observedAt: builtAt,
    capturedAt: builtAt,
    providers,
    primaryProvider: providers[0] ?? null,
    mode: providers.length > 1 ? 'composed' : 'live',
    freshnessPolicy: routeFor('current_quotes').freshness,
    payload,
    containsMockData,
    usable: Object.keys(quotePayload).length > 0 || Object.keys(historyPayload).length > 0 || distributionPayload.length > 0,
    notes: [
      'Market Snapshot is composed only from independently persisted per-symbol evidence.',
      retainedCount ? `${retainedCount} per-symbol evidence records are retained last-known-good and visibly aged.` : 'All included per-symbol evidence is within its current freshness window.',
      'Stored quotes support display/analysis continuity only; execution must obtain a fresh broker-authoritative quote.',
    ],
  }));

  return { payload, persisted };
}

function isPreparedMarketPayload(value: unknown): value is PreparedMarketPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PreparedMarketPayload>;
  return row.version === 'market-v1'
    && typeof row.builtAt === 'string'
    && Boolean(row.quotes)
    && Boolean(row.priceHistory)
    && Array.isArray(row.distributions)
    && Boolean(row.evidence);
}

export async function loadPreparedMarketPayload(now: Date = new Date()): Promise<{
  payload: PreparedMarketPayload;
  freshness: SnapshotFreshness;
  containsMockData: boolean;
  notes: string[];
} | null> {
  const loaded = await loadDataPlaneSnapshot<PreparedMarketPayload>('market', now);
  if (!loaded || (loaded.freshness !== 'fresh' && loaded.freshness !== 'stale_usable')) return null;
  if (!loaded.snapshot.quality.usable || !isPreparedMarketPayload(loaded.snapshot.payload)) return null;
  return {
    payload: loaded.snapshot.payload,
    freshness: loaded.freshness,
    containsMockData: loaded.snapshot.quality.containsMockData,
    notes: loaded.snapshot.quality.notes,
  };
}

export async function loadPreparedMarketProvider(now: Date = new Date()): Promise<MarketDataProvider | null> {
  const loaded = await loadPreparedMarketPayload(now);
  if (!loaded) return null;
  const { payload } = loaded;
  return {
    id: 'prepared-market-snapshot',
    isMock: loaded.containsMockData,
    sourceNotes: [
      ...loaded.notes,
      `Prepared Market Snapshot composed at ${payload.builtAt} (${loaded.freshness}).`,
    ],
    async getQuotes(symbols) {
      return Object.fromEntries(symbols
        .map((symbol) => symbol.toUpperCase())
        .filter((symbol) => payload.quotes[symbol])
        .map((symbol) => [symbol, payload.quotes[symbol]]));
    },
    async getPriceHistory(symbols) {
      return Object.fromEntries(symbols
        .map((symbol) => symbol.toUpperCase())
        .filter((symbol) => payload.priceHistory[symbol])
        .map((symbol) => [symbol, payload.priceHistory[symbol]]));
    },
    async getDistributions(symbols) {
      const requested = new Set(symbols.map((symbol) => symbol.toUpperCase()));
      return payload.distributions.filter((row) => requested.has(row.symbol.toUpperCase()));
    },
  };
}
