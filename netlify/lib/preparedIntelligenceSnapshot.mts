import { refreshStableAdvancedEvidenceFabric } from './intelligenceV3Stable.mts';
import type { AdvancedEvidenceFabric } from './intelligenceV3.mts';
import { refreshCashYieldBenchmark } from './cashYieldBenchmark.mts';
import {
  refreshFinnhubExpandedEarnings,
  type FinnhubExpandedEarningsSnapshot,
} from './finnhubExpandedEarnings.mts';
import { createDataPlaneSnapshot, type SnapshotFreshness } from '../../src/data/dataPlane.js';
import { loadDataPlaneSnapshot, saveDataPlaneSnapshot } from './dataPlaneSnapshotStore.mts';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export interface PreparedIntelligencePayload {
  version: 'intelligence-v1';
  builtAt: string;
  advancedEvidenceV3: AdvancedEvidenceFabric;
  cashYieldBenchmark: Awaited<ReturnType<typeof refreshCashYieldBenchmark>>;
  finnhubExpandedEarnings: FinnhubExpandedEarningsSnapshot;
}

function recomputeFusion(fabric: AdvancedEvidenceFabric): AdvancedEvidenceFabric['fusion'] {
  const statuses = Object.values(fabric.lanes);
  const liveLaneCount = statuses.filter((row) => row.status === 'live').length;
  const partialLaneCount = statuses.filter((row) => row.status === 'partial').length;
  const unavailableLaneCount = statuses.filter((row) => row.status === 'unavailable').length;
  return {
    ...fabric.fusion,
    coveragePct: Math.round(((liveLaneCount + partialLaneCount * 0.5) / statuses.length) * 100),
    liveLaneCount,
    partialLaneCount,
    unavailableLaneCount,
    note: 'Evidence Fusion v3 uses persisted lane evidence. Finnhub earnings coverage is expanded independently from the heavier OpenBB/SEC/FINRA company lanes; route health, item count and lane-live state remain separate facts.',
  };
}

function mergeExpandedEarnings(
  fabric: AdvancedEvidenceFabric,
  expanded: FinnhubExpandedEarningsSnapshot,
): AdvancedEvidenceFabric {
  const bySymbol = new Map(fabric.earnings.map((row) => [row.symbol, row]));
  for (const row of expanded.evidence) bySymbol.set(row.symbol, row);
  const earnings = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (!expanded.requestedSymbols.length) return fabric;
  const incomplete = expanded.failedSymbols.length > 0 || expanded.emptySymbols.length > 0;
  const lane = {
    ...fabric.lanes.earnings,
    status: earnings.length ? (incomplete ? 'partial' as const : 'live' as const) : 'unavailable' as const,
    sources: [...new Set([...fabric.lanes.earnings.sources, 'Finnhub expanded company earnings'])],
    itemCount: earnings.length,
    asOf: earnings.length ? expanded.asOf : fabric.lanes.earnings.asOf,
    caveats: [...new Set([
      ...fabric.lanes.earnings.caveats,
      `Finnhub earnings research targets ${expanded.requestedSymbols.length} strategy companies rather than the original fixed eight.`,
      ...(expanded.failedSymbols.length ? [`${expanded.failedSymbols.length} expanded-universe request failure${expanded.failedSymbols.length === 1 ? '' : 's'} occurred; prior verified rows were retained when available.`] : []),
      ...(expanded.emptySymbols.length ? [`${expanded.emptySymbols.length} requested symbol${expanded.emptySymbols.length === 1 ? '' : 's'} returned no usable earnings rows and remains UNKNOWN for this evidence family.`] : []),
    ])],
  };

  const merged: AdvancedEvidenceFabric = {
    ...fabric,
    earnings,
    lanes: { ...fabric.lanes, earnings: lane },
    fusion: fabric.fusion,
  };
  merged.fusion = recomputeFusion(merged);
  return merged;
}

export async function refreshPreparedIntelligenceSnapshot(): Promise<{
  payload: PreparedIntelligencePayload;
  persisted: boolean;
}> {
  const [stableFabric, cashBenchmark, expandedEarnings] = await Promise.all([
    refreshStableAdvancedEvidenceFabric(),
    refreshCashYieldBenchmark(),
    refreshFinnhubExpandedEarnings(),
  ]);
  const fabric = mergeExpandedEarnings(stableFabric, expandedEarnings);
  const builtAt = new Date().toISOString();
  const payload: PreparedIntelligencePayload = {
    version: 'intelligence-v1',
    builtAt,
    advancedEvidenceV3: fabric,
    cashYieldBenchmark: cashBenchmark,
    finnhubExpandedEarnings: expandedEarnings,
  };

  const usableLaneCount = fabric.fusion.liveLaneCount + fabric.fusion.partialLaneCount;
  const persisted = await saveDataPlaneSnapshot(createDataPlaneSnapshot({
    domain: 'intelligence',
    observedAt: builtAt,
    capturedAt: builtAt,
    providers: ['openbb', 'finnhub'],
    primaryProvider: null,
    mode: 'composed',
    freshnessPolicy: { freshForMs: HOUR, staleUsableForMs: 14 * DAY },
    payload,
    usable: usableLaneCount > 0 || Boolean(cashBenchmark.event) || expandedEarnings.evidence.length > 0,
    containsMockData: false,
    notes: [
      'V3 lane status remains independent from route health and independent from raw Finnhub item counts.',
      'Finnhub earnings breadth is expanded without multiplying unrelated OpenBB/SEC/FINRA company calls.',
      'Retained V3 lanes are marked partial, never live.',
      'This snapshot is research evidence and cannot supply execution pricing.',
    ],
  }));
  return { payload, persisted };
}

function isPreparedIntelligencePayload(value: unknown): value is PreparedIntelligencePayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PreparedIntelligencePayload>;
  return row.version === 'intelligence-v1'
    && typeof row.builtAt === 'string'
    && Boolean(row.advancedEvidenceV3)
    && Boolean(row.finnhubExpandedEarnings);
}

export async function loadPreparedIntelligenceSnapshot(now: Date = new Date()): Promise<{
  payload: PreparedIntelligencePayload;
  freshness: SnapshotFreshness;
} | null> {
  const loaded = await loadDataPlaneSnapshot<PreparedIntelligencePayload>('intelligence', now);
  if (!loaded || (loaded.freshness !== 'fresh' && loaded.freshness !== 'stale_usable')) return null;
  if (!loaded.snapshot.quality.usable || !isPreparedIntelligencePayload(loaded.snapshot.payload)) return null;
  return { payload: loaded.snapshot.payload, freshness: loaded.freshness };
}
