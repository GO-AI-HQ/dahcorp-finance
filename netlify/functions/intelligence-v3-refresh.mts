import type { Config } from '@netlify/functions';
import { refreshPreparedIntelligenceSnapshot } from '../lib/preparedIntelligenceSnapshot.mts';

/**
 * Hourly production evidence refresh for Intelligence Fabric v3.
 *
 * The prepared Intelligence Snapshot now owns the full refresh orchestration:
 * stable V3/OpenBB lanes, cash-yield benchmark evidence, and a broader Finnhub
 * company-earnings universe. Finnhub expansion is cached for six hours so the
 * broader company set does not create an hourly request burst.
 *
 * This observer is read-only: no LLM call, recommendation write, or broker
 * execution can be initiated from the refresh job.
 */
export default async () => {
  const { payload, persisted } = await refreshPreparedIntelligenceSnapshot();
  const fabric = payload.advancedEvidenceV3;
  console.log(`[dahcorp] fabric v3 refresh: coverage=${fabric.fusion.coveragePct}% live=${fabric.fusion.liveLaneCount} partial=${fabric.fusion.partialLaneCount} finnhubEarnings=${payload.finnhubExpandedEarnings.evidence.length}/${payload.finnhubExpandedEarnings.requestedSymbols.length} dataPlane=${persisted ? 'persisted' : 'not-persisted'}.`);
};

export const config: Config = {
  schedule: '17 * * * *',
};
