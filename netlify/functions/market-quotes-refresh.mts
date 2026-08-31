import type { Config } from '@netlify/functions';
import { refreshQuoteEvidence } from '../lib/marketEvidenceRefresh.mts';

export default async () => {
  const result = await refreshQuoteEvidence();
  console.log(`[dahcorp] quote evidence refresh: requested=${result.requested} stored=${result.stored} marketSnapshotPersisted=${result.marketSnapshotPersisted}.`);
};

export const config: Config = {
  // Four times per hour, offset from the top-of-hour V3 refresh.
  schedule: '7,22,37,52 * * * *',
};
