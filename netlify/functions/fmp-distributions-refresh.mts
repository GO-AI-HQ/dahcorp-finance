import type { Config } from '@netlify/functions';
import { INCOME_UNIVERSE } from '../../src/core/universe.js';
import { getFmpDistributions } from '../lib/fmpDistributionProvider.mts';
import { persistStableDistributionEvidence } from '../lib/stableDistributionEvidence.mts';

/**
 * Warm the verified FMP dividend cache once per day. Dividend declarations are
 * low-frequency data; a 24-hour cache plus the OpenBB fallback is enough for
 * personal strategy modeling and leaves substantial room inside the 250-call
 * daily plan for discovery and newly-held symbols.
 *
 * Last-good distribution snapshots are persisted here, outside interactive
 * page requests, so Overview/Income/Strategy Lab never wait on persistence.
 */
export default async () => {
  const asOf = new Date().toISOString().slice(0, 10);
  const result = await getFmpDistributions([...INCOME_UNIVERSE], asOf, 420, { forceRefresh: true });
  if (result.events.length) {
    await persistStableDistributionEvidence(result.events, 'scheduled FMP distribution refresh');
  }
  console.log(`[dahcorp] FMP distribution refresh: symbols=${INCOME_UNIVERSE.length} calls=${result.callsUsed} events=${result.events.length}.`);
};

export const config: Config = {
  schedule: '41 6 * * *',
};
