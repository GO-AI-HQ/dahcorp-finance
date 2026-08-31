import type { Config } from '@netlify/functions';
import { refreshHistoryEvidence } from '../lib/marketEvidenceRefresh.mts';

export default async () => {
  const result = await refreshHistoryEvidence();
  console.log(`[dahcorp] history evidence refresh: requested=${result.requested} stored=${result.stored} marketSnapshotPersisted=${result.marketSnapshotPersisted}.`);
};

export const config: Config = {
  // Historical bars change far more slowly than display quotes.
  schedule: '27 */6 * * *',
};
