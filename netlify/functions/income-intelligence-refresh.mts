import type { Config } from '@netlify/functions';
import { refreshIncomeIntelligence } from '../lib/incomeIntelligence.mts';

/**
 * Daily read-only income research. FMP is intentionally not treated as an
 * intraday trading feed: one daily discovery pass is enough to refresh upcoming
 * distributions, dividend screens and candidate history while preserving API
 * headroom. No LLM or broker execution runs here.
 */
export default async () => {
  const { snapshot, persisted } = await refreshIncomeIntelligence();
  console.log(`[dahcorp] income intelligence: candidates=${snapshot.candidates.length} upcoming=${snapshot.upcoming.length} calls=${snapshot.callsUsed} persisted=${persisted}.`);
};

export const config: Config = {
  schedule: '11 7 * * *',
};
