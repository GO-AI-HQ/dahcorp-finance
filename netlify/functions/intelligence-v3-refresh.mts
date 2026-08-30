import type { Config } from '@netlify/functions';
import { refreshAdvancedEvidenceFabric } from '../lib/intelligenceV3.mts';

/**
 * Hourly production evidence refresh for Intelligence Fabric v3.
 * This observer is read-only: no LLM call, recommendation write, or broker
 * execution can be initiated from the refresh job.
 */
export default async () => {
  const { fabric, persisted } = await refreshAdvancedEvidenceFabric();
  console.log(`[dahcorp] fabric v3 refresh: coverage=${fabric.fusion.coveragePct}% persisted=${persisted}.`);
};

export const config: Config = {
  schedule: '17 * * * *',
};
