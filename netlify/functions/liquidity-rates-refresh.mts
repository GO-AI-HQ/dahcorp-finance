import type { Config } from '@netlify/functions';
import { refreshSavingsRateBenchmark } from '../lib/rateApi.mts';

/**
 * Refresh retail savings benchmarks every other day. RateAPI is a supporting
 * data source, not a high-frequency market feed, so this stays comfortably
 * below low-volume API quotas while keeping the card useful.
 */
export default async () => {
  const benchmark = await refreshSavingsRateBenchmark();
  console.log(`[dahcorp] savings benchmark refresh: status=${benchmark.status} asOf=${benchmark.asOf ?? 'unknown'}.`);
};

export const config: Config = {
  schedule: '37 13 */2 * *',
};
