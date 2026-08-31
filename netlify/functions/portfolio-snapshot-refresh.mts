import type { Config } from '@netlify/functions';
import { refreshPreparedPortfolioSnapshot } from '../lib/preparedPortfolioSnapshot.mts';

/**
 * Background refresh for the prepared Portfolio Snapshot. This intentionally
 * runs away from page navigation so broker/provider latency cannot directly
 * become UI latency. It is a transitional composite refresh; PR34 will separate
 * higher-frequency quote work from lower-frequency history/distribution work
 * before interactive endpoints are fully cut over to snapshots.
 */
export default async () => {
  const { payload, persisted } = await refreshPreparedPortfolioSnapshot();
  console.log(`[dahcorp] prepared portfolio refresh: accounts=${payload.snapshot.accounts.length} holdings=${payload.snapshot.holdings.length} quotes=${Object.keys(payload.snapshot.quotes).length} persisted=${persisted}.`);
};

export const config: Config = {
  // Offset from the top-of-hour V3 job so OpenBB is not hit by both refreshers
  // at the same instant.
  schedule: '47 * * * *',
};
