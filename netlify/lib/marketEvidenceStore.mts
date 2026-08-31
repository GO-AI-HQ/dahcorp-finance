import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import type { DistributionEvent, PriceBar, Quote } from '../../src/core/types.js';
import {
  classifySnapshotFreshness,
  routeFor,
  type DataPlaneRequirement,
  type SnapshotFreshness,
} from '../../src/data/dataPlane.js';

export type MarketEvidenceKind = 'quote' | 'history' | 'distribution';

export interface MarketEvidencePayloadMap {
  quote: Quote;
  history: PriceBar[];
  distribution: DistributionEvent[];
}

export interface StoredMarketEvidence<K extends MarketEvidenceKind = MarketEvidenceKind> {
  schemaVersion: 1;
  kind: K;
  symbol: string;
  capturedAt: string;
  observedAt: string;
  providerId: string;
  containsMockData: boolean;
  payload: MarketEvidencePayloadMap[K];
}

export interface LoadedMarketEvidence<K extends MarketEvidenceKind = MarketEvidenceKind> {
  evidence: StoredMarketEvidence<K>;
  freshness: SnapshotFreshness;
  persistedAt: string | null;
}

const PREFIX = 'market_evidence:v1:';

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function keyFor(kind: MarketEvidenceKind, symbol: string): string {
  return `${PREFIX}${kind}:${normalizeSymbol(symbol)}`;
}

function requirementFor(kind: MarketEvidenceKind): DataPlaneRequirement {
  if (kind === 'quote') return 'current_quotes';
  if (kind === 'history') return 'price_history';
  return 'distribution_history';
}

function isEvidenceShape<K extends MarketEvidenceKind>(
  value: unknown,
  kind: K,
  symbol: string,
): value is StoredMarketEvidence<K> {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StoredMarketEvidence<K>>;
  return row.schemaVersion === 1
    && row.kind === kind
    && row.symbol === normalizeSymbol(symbol)
    && typeof row.capturedAt === 'string'
    && typeof row.observedAt === 'string'
    && typeof row.providerId === 'string'
    && typeof row.containsMockData === 'boolean'
    && 'payload' in row;
}

export async function saveMarketEvidence<K extends MarketEvidenceKind>(args: {
  kind: K;
  symbol: string;
  observedAt?: string;
  providerId: string;
  containsMockData: boolean;
  payload: MarketEvidencePayloadMap[K];
}): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const capturedAt = new Date().toISOString();
  const evidence: StoredMarketEvidence<K> = {
    schemaVersion: 1,
    kind: args.kind,
    symbol: normalizeSymbol(args.symbol),
    capturedAt,
    observedAt: args.observedAt ?? capturedAt,
    providerId: args.providerId,
    containsMockData: args.containsMockData,
    payload: args.payload,
  };
  try {
    await db
      .insert(schema.settings)
      .values({ key: keyFor(args.kind, args.symbol), value: evidence })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: evidence, updatedAt: new Date() },
      });
    return true;
  } catch (error) {
    console.error(`[dahcorp] saveMarketEvidence(${args.kind}:${args.symbol}) failed:`, error);
    return false;
  }
}

export async function loadMarketEvidence<K extends MarketEvidenceKind>(
  kind: K,
  symbol: string,
  now: Date = new Date(),
): Promise<LoadedMarketEvidence<K> | null> {
  const db = getDb();
  if (!db) return null;
  const normalized = normalizeSymbol(symbol);
  try {
    const rows = await db
      .select({ value: schema.settings.value, updatedAt: schema.settings.updatedAt })
      .from(schema.settings)
      .where(eq(schema.settings.key, keyFor(kind, normalized)))
      .limit(1);
    const row = rows[0];
    if (!row || !isEvidenceShape(row.value, kind, normalized)) return null;
    const evidence = row.value as StoredMarketEvidence<K>;
    return {
      evidence,
      freshness: classifySnapshotFreshness(evidence.observedAt, routeFor(requirementFor(kind)).freshness, now),
      persistedAt: row.updatedAt?.toISOString?.() ?? null,
    };
  } catch (error) {
    console.error(`[dahcorp] loadMarketEvidence(${kind}:${normalized}) failed:`, error);
    return null;
  }
}

export async function loadUsableMarketEvidence<K extends MarketEvidenceKind>(
  kind: K,
  symbol: string,
  now: Date = new Date(),
): Promise<LoadedMarketEvidence<K> | null> {
  const loaded = await loadMarketEvidence(kind, symbol, now);
  if (!loaded || (loaded.freshness !== 'fresh' && loaded.freshness !== 'stale_usable')) return null;
  return loaded;
}

export async function loadUsableMarketEvidenceSet<K extends MarketEvidenceKind>(
  kind: K,
  symbols: string[],
  now: Date = new Date(),
): Promise<Map<string, LoadedMarketEvidence<K>>> {
  const normalized = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const rows = await Promise.all(normalized.map(async (symbol) => ({
    symbol,
    loaded: await loadUsableMarketEvidence(kind, symbol, now),
  })));
  return new Map(rows.filter((row) => row.loaded != null).map((row) => [row.symbol, row.loaded as LoadedMarketEvidence<K>]));
}
