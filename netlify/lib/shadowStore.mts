import { desc } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';

export interface ShadowDecisionInput {
  marketDate: string;
  fingerprint: string;
  strategy: string;
  symbol: string;
  action: string;
  accountExternalId?: string | null;
  price: number;
  score: number;
  suggestedNotional: number;
  rationale: string;
  modelSource?: string;
  model?: string | null;
  signals: unknown;
  riskVerdict?: unknown | null;
}

export interface ShadowEvidenceSummary {
  totalObservations: number;
  distinctMarketDays: number;
  actionCounts: Record<string, number>;
  symbolCounts: Record<string, number>;
  latest: Array<{
    id: number;
    createdAt: Date;
    marketDate: string;
    strategy: string;
    symbol: string;
    action: string;
    price: number;
    score: number;
    suggestedNotional: number;
    rationale: string;
    modelSource: string;
    model: string | null;
    signals: unknown;
    riskVerdict: unknown | null;
    outcome: unknown | null;
  }>;
}

export async function saveShadowDecisions(inputs: ShadowDecisionInput[]): Promise<number> {
  const db = getDb();
  if (!db || !inputs.length) return 0;
  const inserted = await db
    .insert(schema.shadowDecisions)
    .values(inputs.map((input) => ({
      marketDate: input.marketDate,
      fingerprint: input.fingerprint,
      strategy: input.strategy,
      symbol: input.symbol.toUpperCase(),
      action: input.action,
      accountExternalId: input.accountExternalId ?? null,
      price: input.price,
      score: input.score,
      suggestedNotional: input.suggestedNotional,
      rationale: input.rationale,
      modelSource: input.modelSource ?? 'deterministic',
      model: input.model ?? null,
      signals: input.signals,
      riskVerdict: input.riskVerdict ?? null,
      status: 'shadow',
    })))
    .onConflictDoNothing({ target: schema.shadowDecisions.fingerprint })
    .returning({ id: schema.shadowDecisions.id });
  return inserted.length;
}

export async function loadShadowEvidence(limit = 12): Promise<ShadowEvidenceSummary> {
  const db = getDb();
  if (!db) {
    return { totalObservations: 0, distinctMarketDays: 0, actionCounts: {}, symbolCounts: {}, latest: [] };
  }

  // The ledger is intentionally small in this phase. Pulling the latest 2,000
  // lightweight rows keeps the summary portable across Drizzle/Netlify versions
  // without database-specific aggregate syntax.
  const rows = await db
    .select()
    .from(schema.shadowDecisions)
    .orderBy(desc(schema.shadowDecisions.createdAt))
    .limit(2000);

  const actionCounts: Record<string, number> = {};
  const symbolCounts: Record<string, number> = {};
  const marketDays = new Set<string>();
  for (const row of rows) {
    marketDays.add(row.marketDate);
    actionCounts[row.action] = (actionCounts[row.action] ?? 0) + 1;
    symbolCounts[row.symbol] = (symbolCounts[row.symbol] ?? 0) + 1;
  }

  return {
    totalObservations: rows.length,
    distinctMarketDays: marketDays.size,
    actionCounts,
    symbolCounts,
    latest: rows.slice(0, Math.max(1, limit)).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      marketDate: row.marketDate,
      strategy: row.strategy,
      symbol: row.symbol,
      action: row.action,
      price: row.price,
      score: row.score,
      suggestedNotional: row.suggestedNotional,
      rationale: row.rationale,
      modelSource: row.modelSource,
      model: row.model,
      signals: row.signals,
      riskVerdict: row.riskVerdict,
      outcome: row.outcome,
    })),
  };
}
