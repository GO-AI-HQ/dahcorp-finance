import type { Config } from '@netlify/functions';
import { INCOME_UNIVERSE } from '../../src/core/universe.js';
import { getFmpDistributions } from '../lib/fmpDistributionProvider.mts';

/**
 * Warm the verified FMP dividend cache twice per day.
 *
 * Ten income symbols x two scheduled refreshes is about 20 calls/day before any
 * occasional newly-held symbol lookup, leaving substantial room inside the
 * 250-call/day personal plan. Dividend declarations are not an intraday quote
 * feed, so higher frequency would add cost without improving decisions.
 */
export default async () => {
  const asOf = new Date().toISOString().slice(0, 10);
  const result = await getFmpDistributions([...INCOME_UNIVERSE], asOf, 420, { forceRefresh: true });
  console.log(`[dahcorp] FMP distribution refresh: symbols=${INCOME_UNIVERSE.length} calls=${result.callsUsed} events=${result.events.length}.`);
};

export const config: Config = {
  schedule: '41 6,18 * * *',
};
