import type { Config } from '@netlify/functions';
import { refreshMarketIntelligence } from '../lib/intelligenceEngine.mts';

/**
 * Deterministic provider refresh. No LLM calls and no broker execution.
 * Hourly cadence keeps the initial Finnhub request budget conservative while
 * the data layer is being validated; real-time WebSocket ingestion can be a
 * later provider-tier upgrade.
 */
export default async () => {
  const result = await refreshMarketIntelligence();
  console.log(`[dahcorp] intelligence refresh: ${result.events.length} normalized, ${result.persisted} persisted.`);
};

export const config: Config = {
  schedule: '7 * * * *',
};
