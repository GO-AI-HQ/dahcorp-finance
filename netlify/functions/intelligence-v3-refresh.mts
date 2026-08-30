import type { Config } from '@netlify/functions';
import { refreshAdvancedEvidenceFabric } from '../lib/intelligenceV3.mts';
import { refreshCashYieldBenchmark } from '../lib/cashYieldBenchmark.mts';

/**
 * Hourly production evidence refresh for Intelligence Fabric v3.
 * This observer is read-only: no LLM call, recommendation write, or broker
 * execution can be initiated from the refresh job.
 */
export default async () => {
  const [{ fabric, persisted }, cashBenchmark] = await Promise.all([
    refreshAdvancedEvidenceFabric(),
    refreshCashYieldBenchmark(),
  ]);
  console.log(`[dahcorp] fabric v3 refresh: coverage=${fabric.fusion.coveragePct}% persisted=${persisted} cashBenchmark=${cashBenchmark.event ? 'live' : 'unavailable'}.`);
};

export const config: Config = {
  schedule: '17 * * * *',
};
