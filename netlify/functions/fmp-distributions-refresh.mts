import type { Config } from '@netlify/functions';
import { refreshDistributionEvidence } from '../lib/marketEvidenceRefresh.mts';

/**
 * Daily low-frequency distribution refresh. This remains the single scheduled
 * path allowed to spend FMP dividend-history calls. The result now updates the
 * existing FMP cache/stable evidence and the new per-symbol Market Snapshot in
 * one pass, with OpenBB retained as fallback where FMP has no usable history.
 */
export default async () => {
  const result = await refreshDistributionEvidence();
  console.log(`[dahcorp] distribution evidence refresh: requested=${result.requested} stored=${result.stored} fmpCalls=${result.fmpCallsUsed} marketSnapshotPersisted=${result.marketSnapshotPersisted}.`);
};

export const config: Config = {
  schedule: '41 6 * * *',
};
