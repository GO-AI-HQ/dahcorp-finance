import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import {
  loadAdvancedEvidenceFabric,
  refreshAdvancedEvidenceFabric,
  type AdvancedEvidenceFabric,
  type EvidenceLaneStatus,
} from './intelligenceV3.mts';
import { latestIntelligenceEventByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';

const PURPOSE = 'advanced_evidence_v3_stable';

type LaneName = keyof AdvancedEvidenceFabric['lanes'];

const MAX_STALE_HOURS: Record<LaneName, number> = {
  options: 6,
  fund_lookthrough: 24 * 7,
  maritime: 48,
  energy_positioning: 24 * 7,
  filings_insiders: 24 * 7,
  earnings: 24 * 7,
  crowding: 24 * 14,
  government_capital: 24 * 7,
};

function isFabric(value: unknown): value is AdvancedEvidenceFabric {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AdvancedEvidenceFabric>;
  return row.version === 'v3' && typeof row.asOf === 'string' && Boolean(row.lanes) && Boolean(row.fusion);
}

function ageHours(asOf: string | null | undefined): number {
  if (!asOf) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(asOf);
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3_600_000) : Number.POSITIVE_INFINITY;
}

function shouldRetain(name: LaneName, current: EvidenceLaneStatus, previous: EvidenceLaneStatus | undefined): boolean {
  if (current.status !== 'unavailable' || !previous || previous.itemCount <= 0 || previous.status === 'unavailable') return false;
  return ageHours(previous.asOf) <= MAX_STALE_HOURS[name];
}

function retainedLane(name: LaneName, previous: EvidenceLaneStatus): EvidenceLaneStatus {
  return {
    ...previous,
    status: 'partial',
    caveats: [
      ...previous.caveats,
      `This refresh could not update ${name.replace(/_/g, ' ')}. The app is retaining the last verified snapshot instead of turning a temporary provider miss into zero evidence.`,
    ],
  };
}

function recomputeFusion(fabric: AdvancedEvidenceFabric): AdvancedEvidenceFabric['fusion'] {
  const statuses = Object.values(fabric.lanes);
  const liveLaneCount = statuses.filter((row) => row.status === 'live').length;
  const partialLaneCount = statuses.filter((row) => row.status === 'partial').length;
  const unavailableLaneCount = statuses.filter((row) => row.status === 'unavailable').length;
  return {
    ...fabric.fusion,
    coveragePct: Math.round(((liveLaneCount + partialLaneCount * 0.5) / 8) * 100),
    liveLaneCount,
    partialLaneCount,
    unavailableLaneCount,
    note: 'Coverage uses the newest successful evidence available for each lane. A retained last-verified lane is marked partial, never live. Missing evidence stays UNKNOWN; retained evidence never becomes execution pricing.',
  };
}

function mergeLastGood(current: AdvancedEvidenceFabric, previous: AdvancedEvidenceFabric | null): AdvancedEvidenceFabric {
  if (!previous) return current;
  const retain = (name: LaneName) => shouldRetain(name, current.lanes[name], previous.lanes[name]);
  const lanes = { ...current.lanes };
  for (const name of Object.keys(lanes) as LaneName[]) {
    if (retain(name)) lanes[name] = retainedLane(name, previous.lanes[name]);
  }

  const merged: AdvancedEvidenceFabric = {
    ...current,
    lanes,
    options: retain('options') ? previous.options : current.options,
    fundLookThrough: retain('fund_lookthrough') ? previous.fundLookThrough : current.fundLookThrough,
    fundOverlap: retain('fund_lookthrough') ? previous.fundOverlap : current.fundOverlap,
    maritime: retain('maritime') ? previous.maritime : current.maritime,
    energy: retain('energy_positioning') ? previous.energy : current.energy,
    company: retain('filings_insiders') ? previous.company : current.company,
    earnings: retain('earnings') ? previous.earnings : current.earnings,
    crowding: retain('crowding') ? previous.crowding : current.crowding,
    governmentCapital: retain('government_capital') ? previous.governmentCapital : current.governmentCapital,
    fusion: current.fusion,
  };
  merged.fusion = recomputeFusion(merged);
  return merged;
}

async function persistStableFabric(fabric: AdvancedEvidenceFabric): Promise<void> {
  const event: IntelligenceEvent = {
    fingerprint: 'advanced-evidence-v3-stable',
    occurredAt: fabric.asOf,
    discoveredAt: new Date().toISOString(),
    source: 'DAHCorp stable research coverage',
    sourceClass: 'openbb',
    sourceUrl: null,
    sourceQuality: 0.9,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `Research coverage: ${fabric.fusion.liveLaneCount} live, ${fabric.fusion.partialLaneCount} retained/partial`,
    summary: fabric.fusion.note,
    symbols: [...new Set([
      ...fabric.options.map((row) => row.symbol),
      ...fabric.fundLookThrough.map((row) => row.symbol),
      ...fabric.earnings.map((row) => row.symbol),
      ...fabric.crowding.map((row) => row.symbol),
    ])],
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: { purpose: PURPOSE, advancedEvidenceV3: fabric },
  };
  await persistIntelligenceEvents([event]);
}

export async function loadStableAdvancedEvidenceFabric(): Promise<AdvancedEvidenceFabric> {
  const event = await latestIntelligenceEventByPurpose(PURPOSE);
  const stored = event?.metadata?.advancedEvidenceV3;
  if (isFabric(stored)) return stored;
  return loadAdvancedEvidenceFabric();
}

export async function refreshStableAdvancedEvidenceFabric(): Promise<AdvancedEvidenceFabric> {
  const previous = await loadStableAdvancedEvidenceFabric().catch(() => null);
  const { fabric: raw } = await refreshAdvancedEvidenceFabric();
  const stable = mergeLastGood(raw, previous);
  await persistStableFabric(stable);
  return stable;
}
