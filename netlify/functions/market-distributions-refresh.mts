import type { Config } from '@netlify/functions';
import { refreshDistributionEvidence } from '../lib/marketEvidenceRefresh.mts';

export default async () => {
  const result = await refreshDistributionEvidence();
  console.log(`[dahcorp] distribution evidence refresh: requested=${result.requested} stored=${result.stored} fmpCalls=${result.fmpCallsUsed} marketSnapshotPersisted=${result.marketSnapshotPersisted}.`);
};

export const config: Config = {
  // Dividend/distribution declarations are low-frequency evidence. This is the
  // scheduled path allowed to spend FMP calls under the existing hard budget.
  schedule: '37 6 * * *',
};
