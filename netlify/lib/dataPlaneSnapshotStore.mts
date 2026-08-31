import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import {
  classifySnapshotFreshness,
  isSnapshotUsable,
  type DataPlaneDomain,
  type DataPlaneSnapshot,
  type SnapshotFreshness,
} from '../../src/data/dataPlane.js';

const SNAPSHOT_KEY_PREFIX = 'data_plane_snapshot:v1:';

function snapshotKey(domain: DataPlaneDomain): string {
  return `${SNAPSHOT_KEY_PREFIX}${domain}`;
}

export interface LoadedDataPlaneSnapshot<T = unknown> {
  snapshot: DataPlaneSnapshot<T>;
  freshness: SnapshotFreshness;
  persistedAt: string | null;
}

function isSnapshotShape(value: unknown, domain: DataPlaneDomain): value is DataPlaneSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DataPlaneSnapshot>;
  return candidate.schemaVersion === 1
    && candidate.domain === domain
    && typeof candidate.capturedAt === 'string'
    && typeof candidate.observedAt === 'string'
    && candidate.source != null
    && candidate.freshnessPolicy != null
    && candidate.quality != null
    && 'payload' in candidate;
}

/**
 * Persist one complete domain snapshot atomically. A failed write never mutates
 * the previously verified snapshot, so readers either see the old valid state
 * or the new valid state — never a half-refreshed domain.
 */
export async function saveDataPlaneSnapshot<T>(snapshot: DataPlaneSnapshot<T>): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db
      .insert(schema.settings)
      .values({ key: snapshotKey(snapshot.domain), value: snapshot })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: snapshot, updatedAt: new Date() },
      });
    return true;
  } catch (error) {
    console.error(`[dahcorp] saveDataPlaneSnapshot(${snapshot.domain}) failed:`, error);
    return false;
  }
}

/**
 * Read the last verified snapshot without contacting an external provider.
 * Invalid/corrupt JSON is treated as absent rather than being promoted into the
 * application data plane.
 */
export async function loadDataPlaneSnapshot<T = unknown>(
  domain: DataPlaneDomain,
  now: Date = new Date(),
): Promise<LoadedDataPlaneSnapshot<T> | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({ value: schema.settings.value, updatedAt: schema.settings.updatedAt })
      .from(schema.settings)
      .where(eq(schema.settings.key, snapshotKey(domain)))
      .limit(1);
    const row = rows[0];
    if (!row || !isSnapshotShape(row.value, domain)) return null;
    const snapshot = row.value as DataPlaneSnapshot<T>;
    return {
      snapshot,
      freshness: classifySnapshotFreshness(snapshot.observedAt, snapshot.freshnessPolicy, now),
      persistedAt: row.updatedAt?.toISOString?.() ?? null,
    };
  } catch (error) {
    console.error(`[dahcorp] loadDataPlaneSnapshot(${domain}) failed:`, error);
    return null;
  }
}

/**
 * Convenience read for UI/server consumers. Expired or explicitly unusable
 * evidence is not returned as a usable state. Call loadDataPlaneSnapshot when
 * diagnostics still need to inspect an expired record and its age.
 */
export async function loadUsableDataPlaneSnapshot<T = unknown>(
  domain: DataPlaneDomain,
  now: Date = new Date(),
): Promise<LoadedDataPlaneSnapshot<T> | null> {
  const loaded = await loadDataPlaneSnapshot<T>(domain, now);
  if (!loaded || !isSnapshotUsable(loaded.snapshot, now)) return null;
  return loaded;
}

export async function dataPlaneSnapshotStatus(now: Date = new Date()): Promise<Record<DataPlaneDomain, {
  present: boolean;
  freshness: SnapshotFreshness | 'missing';
  observedAt: string | null;
  persistedAt: string | null;
  providers: string[];
  usable: boolean;
}>> {
  const domains: DataPlaneDomain[] = ['portfolio', 'market', 'income', 'intelligence', 'strategy', 'strategy_basis'];
  const rows = await Promise.all(domains.map(async (domain) => ({ domain, loaded: await loadDataPlaneSnapshot(domain, now) })));
  return Object.fromEntries(rows.map(({ domain, loaded }) => [domain, loaded ? {
    present: true,
    freshness: loaded.freshness,
    observedAt: loaded.snapshot.observedAt,
    persistedAt: loaded.persistedAt,
    providers: loaded.snapshot.source.providers,
    usable: isSnapshotUsable(loaded.snapshot, now),
  } : {
    present: false,
    freshness: 'missing',
    observedAt: null,
    persistedAt: null,
    providers: [],
    usable: false,
  }])) as Record<DataPlaneDomain, {
    present: boolean;
    freshness: SnapshotFreshness | 'missing';
    observedAt: string | null;
    persistedAt: string | null;
    providers: string[];
    usable: boolean;
  }>;
}
