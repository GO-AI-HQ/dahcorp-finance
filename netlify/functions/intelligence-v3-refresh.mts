import type { Config } from '@netlify/functions';
import { refreshStableAdvancedEvidenceFabric } from '../lib/intelligenceV3Stable.mts';
import { refreshCashYieldBenchmark } from '../lib/cashYieldBenchmark.mts';

/**
 * Hourly production evidence refresh for Intelligence Fabric v3.
 * The signed OpenBB client meters provider traffic, and the stable wrapper keeps
 * a recent last-verified lane as partial evidence when a single refresh misses.
 * This observer is read-only: no LLM call, recommendation write, or broker
 * execution can be initiated from the refresh job.
 */
export default async () => {
  const [fabric, cashBenchmark] = await Promise.all([
    refreshStableAdvancedEvidenceFabric(),
    refreshCashYieldBenchmark(),
  ]);
  console.log(`[dahcorp] fabric v3 refresh: coverage=${fabric.fusion.coveragePct}% live=${fabric.fusion.liveLaneCount} partial=${fabric.fusion.partialLaneCount} cashBenchmark=${cashBenchmark.event ? 'live' : 'unavailable'}.`);
};

export const config: Config = {
  schedule: '17 * * * *',
};
