/**
 * Model output contract.
 *
 * An LLM produces a recommendation, never execution authority. Each leg is
 * independently validated and, if live-capable, staged through a broker-specific
 * preview/confirmation path.
 */
export type Confidence = 'high' | 'medium' | 'low';

export interface RecommendedLeg {
  symbol: string;
  /** Dollar value of the proposed transaction. */
  amount: number;
  accountId: string;
  /** Defaults to buy for backwards-compatible recommendations. */
  side?: 'buy' | 'sell';
  reason: string;
}

export interface RecommendationBrief {
  headline: string;
  confidence: Confidence;
  thesis: string;
  legs: RecommendedLeg[];
  risks: string[];
  alternative: {
    summary: string;
    legs: RecommendedLeg[];
    tradeoff: string;
  } | null;
  etaImpact: string;
  notes: string[];
  dataCaveats: string[];
}

export type AgentSource = 'openai' | 'claude' | 'deterministic';

export interface AgentResult {
  brief: RecommendationBrief;
  source: AgentSource;
  model: string | null;
  fallbackReason: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}
