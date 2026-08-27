/**
 * Structured-output contract for the recommendation.
 *
 * Claude is required to answer through this tool so the response is parsed, not
 * scraped. Anything that fails validation is discarded in favour of the
 * deterministic brief — a malformed model response never becomes a silent
 * half-recommendation.
 */
import type { RecommendationBrief, RecommendedLeg } from './types.js';

export const RECOMMENDATION_TOOL = {
  name: 'submit_recommendation',
  description:
    'Submit the portfolio recommendation. This is advisory only: a deterministic risk engine validates it afterwards and may reduce or reject any leg.',
  input_schema: {
    type: 'object' as const,
    properties: {
      headline: { type: 'string', description: 'One sentence: the decision.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      thesis: { type: 'string', description: 'Why this, now, in strategic terms. 2-4 sentences.' },
      legs: {
        type: 'array',
        description: 'Proposed allocation. Empty array means recommend holding cash.',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            amount: { type: 'number', description: 'Dollars.' },
            accountId: { type: 'string', description: 'Must be an allocation-eligible account id.' },
            reason: { type: 'string' },
          },
          required: ['symbol', 'amount', 'accountId', 'reason'],
        },
      },
      risks: { type: 'array', items: { type: 'string' }, description: 'What would make this the wrong call.' },
      alternative: {
        type: 'object',
        description: 'A genuinely different allocation, with its trade-off.',
        properties: {
          summary: { type: 'string' },
          legs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                amount: { type: 'number' },
                accountId: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['symbol', 'amount', 'accountId', 'reason'],
            },
          },
          tradeoff: { type: 'string' },
        },
        required: ['summary', 'legs', 'tradeoff'],
      },
      etaImpact: { type: 'string', description: 'Effect on the milestone ETA. Be honest when it is small.' },
      notes: { type: 'array', items: { type: 'string' } },
      dataCaveats: { type: 'array', items: { type: 'string' } },
    },
    required: ['headline', 'confidence', 'thesis', 'legs', 'risks', 'etaImpact'],
  },
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asLegs(value: unknown): RecommendedLeg[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      if (typeof raw !== 'object' || raw === null) return null;
      const leg = raw as Record<string, unknown>;
      const symbol = asString(leg.symbol).toUpperCase();
      const amount = typeof leg.amount === 'number' && Number.isFinite(leg.amount) ? leg.amount : NaN;
      const accountId = asString(leg.accountId);
      if (!symbol || !accountId || !Number.isFinite(amount) || amount <= 0) return null;
      return { symbol, amount, accountId, reason: asString(leg.reason, 'No reason supplied.') };
    })
    .filter((l): l is RecommendedLeg => l !== null);
}

/** Parse and sanitise the model's tool input. Returns null when unusable. */
export function parseRecommendation(input: unknown): RecommendationBrief | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  const headline = asString(raw.headline).trim();
  const thesis = asString(raw.thesis).trim();
  if (!headline || !thesis) return null;

  const confidenceRaw = asString(raw.confidence, 'medium').toLowerCase();
  const confidence = confidenceRaw === 'high' || confidenceRaw === 'low' ? confidenceRaw : 'medium';

  const alternativeRaw = raw.alternative;
  const alternative =
    typeof alternativeRaw === 'object' && alternativeRaw !== null
      ? (() => {
          const alt = alternativeRaw as Record<string, unknown>;
          const summary = asString(alt.summary).trim();
          if (!summary) return null;
          return { summary, legs: asLegs(alt.legs), tradeoff: asString(alt.tradeoff) };
        })()
      : null;

  return {
    headline,
    confidence,
    thesis,
    legs: asLegs(raw.legs),
    risks: asStringArray(raw.risks),
    alternative,
    etaImpact: asString(raw.etaImpact),
    notes: asStringArray(raw.notes),
    dataCaveats: asStringArray(raw.dataCaveats),
  };
}
