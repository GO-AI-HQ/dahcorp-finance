import type { Config } from '@netlify/functions';
import { refreshSavingsRateBenchmark } from '../lib/rateApi.mts';

/**
 * RateAPI is a supporting household-cash benchmark, not a trading feed. Refresh
 * it twice a week and keep the last verified result between refreshes so the
 * 50-call/month free plan has generous headroom for manual checks.
 */
export default async () => {
  const benchmark = await refreshSavingsRateBenchmark();
  console.log(`[dahcorp] savings benchmark refresh: status=${benchmark.status} asOf=${benchmark.asOf ?? 'unknown'}.`);
};

export const config: Config = {
  schedule: '37 13 * * 2,5',
};
