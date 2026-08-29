/**
 * Model output contract.
 *
 * An LLM produces a *recommendation*, never an instruction. The shape below is
 * advisory data: it is handed to the deterministic risk engine, which decides
 * independently what (if anything) may happen. Nothing in this file can move
 * capital.
 */
export type Confidence = 'high' | 'medium' | 'low';

export interface RecommendedLeg {
  symbol: string;
  /** Dollars suggested. The risk engine may reduce or reject this. */
  amount: number;
  accountId: string;
  reason: string;
}

export interface RecommendationBrief {
  headline: string;
  confidence: Confidence;
  /** Why this, now, in the investor's own strategic terms. */
  thesis: string;
  legs: RecommendedLeg[];
  /** What would make this the wrong decision. */
  risks: string[];
  /** A genuinely different allocation, so the investor sees a real choice. */
  alternative: {
    summary: string;
    legs: RecommendedLeg[];
    tradeoff: string;
  } | null;
  /** Expected effect on the milestone ETA, described qualitatively. */
  etaImpact: string;
  /** Answers to the standing strategic questions, when relevant. */
  notes: string[];
  /** Data limitations the model itself flagged. */
  dataCaveats: string[];
}

export type AgentSource = 'openai' | 'claude' | 'deterministic';

export interface AgentResult {
  brief: RecommendationBrief;
  source: AgentSource;
  model: string | null;
  /** Why the deterministic fallback was used, if it was. */
  fallbackReason: string | null;
  /** Raw token usage, for cost visibility. */
  usage: { inputTokens: number; outputTokens: number } | null;
}
