import type { Config } from '@netlify/functions';
import { refreshStableAdvancedEvidenceFabric } from '../lib/intelligenceV3Stable.mts';
import { refreshCashYieldBenchmark } from '../lib/cashYieldBenchmark.mts';
import { saveDataPlaneSnapshot } from '../lib/dataPlaneSnapshotStore.mts';
import { createDataPlaneSnapshot } from '../../src/data/dataPlane.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * Hourly production evidence refresh for Intelligence Fabric v3.
 * The signed OpenBB client meters provider traffic, and the stable wrapper keeps
 * a recent last-verified lane as partial evidence when a single refresh misses.
 *
 * PR34 also writes the resulting fabric into the durable Intelligence Snapshot.
 * This does not replace the existing purpose-scoped intelligence ledger; it
 * creates the prepared read model that downstream UI/model consumers can move
 * to without repeating provider work on page load.
 *
 * This observer is read-only: no LLM call, recommendation write, or broker
 * execution can be initiated from the refresh job.
 */
export default async () => {
  const [fabric, cashBenchmark] = await Promise.all([
    refreshStableAdvancedEvidenceFabric(),
    refreshCashYieldBenchmark(),
  ]);

  const usableLaneCount = fabric.fusion.liveLaneCount + fabric.fusion.partialLaneCount;
  const snapshotPersisted = await saveDataPlaneSnapshot(createDataPlaneSnapshot({
    domain: 'intelligence',
    observedAt: fabric.asOf,
    providers: ['openbb', 'finnhub'],
    primaryProvider: null,
    mode: 'composed',
    // Per-lane freshness remains authoritative inside the V3 fabric. The outer
    // envelope only controls whether the prepared composite can be used at all.
    freshnessPolicy: { freshForMs: HOUR, staleUsableForMs: 14 * DAY },
    payload: {
      advancedEvidenceV3: fabric,
      cashYieldBenchmark: cashBenchmark,
    },
    usable: usableLaneCount > 0 || Boolean(cashBenchmark.event),
    containsMockData: false,
    notes: [
      'V3 lane status remains independent from route health and independent from Finnhub item counts.',
      'Retained V3 lanes are marked partial, never live.',
      'This snapshot is research evidence and cannot supply execution pricing.',
    ],
  }));

  console.log(`[dahcorp] fabric v3 refresh: coverage=${fabric.fusion.coveragePct}% live=${fabric.fusion.liveLaneCount} partial=${fabric.fusion.partialLaneCount} cashBenchmark=${cashBenchmark.event ? 'live' : 'unavailable'} dataPlane=${snapshotPersisted ? 'persisted' : 'not-persisted'}.`);
};

export const config: Config = {
  schedule: '17 * * * *',
};
