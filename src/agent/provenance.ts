import type { SnapshotFreshness } from '../data/dataPlane.js';

export type ModelPreparationReadMode = 'prepared_snapshot' | 'live_cold_start_fallback';
export type ModelMarketSource = 'prepared_market_snapshot' | 'portfolio_snapshot_embedded' | 'live_cold_start_fallback';
export type ModelIntelligenceSource = 'prepared_intelligence_snapshot' | 'stable_evidence_ledger_fallback';

/**
 * Compact, non-secret provenance handed to both model providers alongside the
 * decision evidence. It describes where the model input came from; it does not
 * grant execution authority and intentionally contains no credentials or raw
 * brokerage account numbers.
 */
export interface ModelDataProvenance {
  schemaVersion: 1;
  generatedAt: string;
  preparation: {
    readMode: ModelPreparationReadMode;
    providerCallsDuringPreparation: 'none' | 'cold_start_broker_and_market_fallback';
  };
  portfolio: {
    asOf: string;
    preparedAt: string | null;
    freshness: SnapshotFreshness | null;
    dataQuality: string;
    containsMockData: boolean;
    marketReadMode: string;
  };
  market: {
    source: ModelMarketSource;
    builtAt: string | null;
    freshness: SnapshotFreshness | null;
    quoteSymbolCount: number;
    historySymbolCount: number;
    distributionSymbolCount: number;
    retainedEvidenceCount: number;
  };
  intelligence: {
    source: ModelIntelligenceSource;
    builtAt: string | null;
    freshness: SnapshotFreshness | null;
    coveragePct: number | null;
    liveLaneCount: number | null;
    partialLaneCount: number | null;
    unavailableLaneCount: number | null;
    expandedFinnhubCompanyCount: number | null;
  };
  constraints: string[];
}
