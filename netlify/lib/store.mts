/**
 * Persistence layer for the functions.
 *
 * Every read has a fallback: with no database attached the app serves the
 * labelled seed model and the audit writes become no-ops that are logged.
 */
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { DEFAULT_STRATEGY_CONFIG, mergeStrategyConfig, type StrategyConfig } from '../../src/core/config.js';
import type { Account, AccountType, BrokerId, Contribution, CorporateAction, DataQuality, Holding, IncomeEvent, Sleeve } from '../../src/core/types.js';
import { parseVerificationStatus } from '../../src/core/scope.js';
import { seedPositionSource, type PositionSource } from '../../src/services/snapshot.js';

const STRATEGY_KEY = 'strategy_config';
const ACTIVE_MODEL_KEY = 'active_strategy_model';

export function databaseAvailable(): boolean { return getDb() != null; }

export interface LoadedConfig { config: StrategyConfig; persisted: boolean; note: string | null; }

export async function loadStrategyConfig(): Promise<LoadedConfig> {
  const db = getDb();
  if (!db) return { config: DEFAULT_STRATEGY_CONFIG, persisted: false, note: 'No database attached — strategy settings are the defaults and changes will not persist.' };
  try {
    const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, STRATEGY_KEY)).limit(1);
    const stored = rows[0]?.value as Partial<StrategyConfig> | undefined;
    return { config: mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, stored ?? {}), persisted: true, note: null };
  } catch (error) {
    console.error('[dahcorp] loadStrategyConfig failed:', error);
    return { config: DEFAULT_STRATEGY_CONFIG, persisted: false, note: 'Strategy settings could not be read. Defaults are in effect.' };
  }
}

export async function saveStrategyConfig(patch: Partial<StrategyConfig>): Promise<LoadedConfig> {
  const db = getDb();
  const current = await loadStrategyConfig();
  const next = mergeStrategyConfig(current.config, patch);
  if (!db) return { ...current, config: next };
  await db.insert(schema.settings).values({ key: STRATEGY_KEY, value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next, updatedAt: new Date() } });
  return { config: next, persisted: true, note: null };
}

export interface ActiveStrategyModel {
  recommendationId: number;
  adoptedAt: string;
  headline: string;
  thesis: string;
  legs: unknown[];
  projection?: unknown;
  sourceEventFingerprint?: string | null;
  status: 'active_pending_execution' | 'active_partially_executed' | 'active_executed';
}

export async function saveActiveStrategyModel(model: ActiveStrategyModel): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db.insert(schema.settings).values({ key: ACTIVE_MODEL_KEY, value: model }).onConflictDoUpdate({ target: schema.settings.key, set: { value: model, updatedAt: new Date() } });
    return true;
  } catch (error) {
    console.error('[dahcorp] saveActiveStrategyModel failed:', error);
    return false;
  }
}

export async function loadActiveStrategyModel(): Promise<ActiveStrategyModel | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, ACTIVE_MODEL_KEY)).limit(1);
    return (rows[0]?.value as ActiveStrategyModel | undefined) ?? null;
  } catch (error) {
    console.error('[dahcorp] loadActiveStrategyModel failed:', error);
    return null;
  }
}

/** Load positions from the database, falling back to the labelled seed model. */
export async function loadPositionSource(asOf: string): Promise<PositionSource> {
  const db = getDb();
  if (!db) return seedPositionSource(asOf);
  try {
    const [accountRows, holdingRows, incomeRows, contributionRows, actionRows] = await Promise.all([
      db.select().from(schema.accounts).where(eq(schema.accounts.archived, false)),
      db.select().from(schema.holdings),
      db.select().from(schema.incomeEvents).orderBy(desc(schema.incomeEvents.payDate)),
      db.select().from(schema.contributions),
      db.select().from(schema.corporateActions),
    ]);
    if (!accountRows.length || !holdingRows.length) return seedPositionSource(asOf);
    const accounts: Account[] = accountRows.map((row) => ({ id: row.externalId, broker: row.broker as BrokerId, name: row.name, type: row.type as AccountType, role: row.role, cash: row.cash, allocationEligible: row.allocationEligible, tradeEligible: row.tradeEligible, dataQuality: row.dataQuality as DataQuality }));
    const holdings: Holding[] = holdingRows.map((row) => ({ id: String(row.id), accountId: row.accountExternalId, symbol: row.symbol.toUpperCase(), shares: row.shares, costBasisTotal: row.costBasisTotal, tacticalCostBasisTotal: row.tacticalCostBasisTotal ?? undefined, sleeve: row.sleeve as Sleeve, legacy: row.legacy, verification: parseVerificationStatus(row.verification) ?? 'CONFIRMED', openedAt: row.openedAt ?? undefined }));
    const incomeEvents: IncomeEvent[] = incomeRows.map((row) => ({ id: String(row.id), accountId: row.accountExternalId, symbol: row.symbol.toUpperCase(), payDate: row.payDate, grossAmount: row.grossAmount, sharesAtRecord: row.sharesAtRecord, reinvested: row.reinvested }));
    const contributions: Contribution[] = contributionRows.map((row) => ({ id: String(row.id), accountId: row.accountExternalId, date: row.date, amount: row.amount, note: row.note ?? undefined }));
    const corporateActions: CorporateAction[] = actionRows.map((row) => ({ symbol: row.symbol.toUpperCase(), effectiveDate: row.effectiveDate, type: row.type as CorporateAction['type'], ratio: row.ratio ?? undefined, newSymbol: row.newSymbol ?? undefined, cashPerShare: row.cashPerShare ?? undefined }));
    const mock = accounts.some((a) => a.dataQuality === 'mock');
    return { origin: 'database', accounts, holdings, incomeEvents: incomeEvents.length ? incomeEvents : null, contributions, corporateActions, notes: mock ? ['Positions are stored records flagged as mock data, not live brokerage data.'] : ['Positions are stored records entered by the investor.'], containsMockData: mock };
  } catch (error) {
    console.error('[dahcorp] loadPositionSource failed:', error);
    const fallback = seedPositionSource(asOf);
    return { ...fallback, notes: [...fallback.notes, 'Stored positions could not be read; showing the seeded mock model.'] };
  }
}

export interface AuditEntry { category: 'auth' | 'config' | 'agent' | 'risk' | 'order' | 'data' | 'error'; action: string; severity?: 'info' | 'warning' | 'error'; message?: string; detail?: unknown; }

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const db = getDb();
  if (!db) { console.log(`[dahcorp][audit:${entry.category}] ${entry.action} — ${entry.message ?? ''}`); return; }
  try { await db.insert(schema.auditLog).values({ category: entry.category, action: entry.action, severity: entry.severity ?? 'info', message: entry.message ?? '', detail: entry.detail === undefined ? null : (entry.detail as object) }); }
  catch (error) { console.error('[dahcorp] recordAudit failed:', error); }
}

export async function listAuditLog(limit = 100) {
  const db = getDb(); if (!db) return [];
  try { return await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(limit); }
  catch (error) { console.error('[dahcorp] listAuditLog failed:', error); return []; }
}

export async function recordIncomeSnapshot(row: { asOf: string; forwardMonthlyIncome: number; incomeEngineCapital: number; blendedDistributionRate: number | null; portfolioValue: number; basis: string; containsMockData: boolean; }): Promise<void> {
  const db = getDb(); if (!db) return;
  try {
    await db.insert(schema.incomeSnapshots).values(row).onConflictDoUpdate({ target: schema.incomeSnapshots.asOf, set: { forwardMonthlyIncome: row.forwardMonthlyIncome, incomeEngineCapital: row.incomeEngineCapital, blendedDistributionRate: row.blendedDistributionRate, portfolioValue: row.portfolioValue, basis: row.basis, containsMockData: row.containsMockData } });
  } catch (error) { console.error('[dahcorp] recordIncomeSnapshot failed:', error); }
}

export async function priorIncomeSnapshot(asOf: string) {
  const db = getDb(); if (!db) return null;
  try { const rows = await db.select().from(schema.incomeSnapshots).where(lt(schema.incomeSnapshots.asOf, asOf)).orderBy(desc(schema.incomeSnapshots.asOf)).limit(1); return rows[0] ?? null; }
  catch (error) { console.error('[dahcorp] priorIncomeSnapshot failed:', error); return null; }
}

export interface RecommendationRecord { question: string; availableCapital: number; source: string; model: string | null; headline: string; confidence: string; brief: unknown; portfolioSnapshot: unknown; deterministicOutcome: unknown; }

export async function saveRecommendation(record: RecommendationRecord): Promise<number | null> {
  const db = getDb(); if (!db) return null;
  try {
    const rows = await db.insert(schema.recommendations).values({ question: record.question, availableCapital: record.availableCapital, source: record.source, model: record.model, headline: record.headline, confidence: record.confidence, brief: record.brief as object, portfolioSnapshot: record.portfolioSnapshot as object, deterministicOutcome: record.deterministicOutcome as object }).returning({ id: schema.recommendations.id });
    return rows[0]?.id ?? null;
  } catch (error) { console.error('[dahcorp] saveRecommendation failed:', error); return null; }
}

export async function getRecommendation(id: number) {
  const db = getDb(); if (!db) return null;
  try { const rows = await db.select().from(schema.recommendations).where(eq(schema.recommendations.id, id)).limit(1); return rows[0] ?? null; }
  catch (error) { console.error('[dahcorp] getRecommendation failed:', error); return null; }
}

export async function listRecommendations(limit = 25) {
  const db = getDb(); if (!db) return [];
  try { return await db.select().from(schema.recommendations).orderBy(desc(schema.recommendations.createdAt)).limit(limit); }
  catch (error) { console.error('[dahcorp] listRecommendations failed:', error); return []; }
}

export async function setRecommendationAction(id: number, userAction: 'approved' | 'rejected' | 'edited', userNote: string | null): Promise<boolean> {
  const db = getDb(); if (!db) return false;
  try { const rows = await db.update(schema.recommendations).set({ userAction, userNote, actedAt: new Date() }).where(and(eq(schema.recommendations.id, id), eq(schema.recommendations.userAction, 'pending'))).returning({ id: schema.recommendations.id }); return rows.length > 0; }
  catch (error) { console.error('[dahcorp] setRecommendationAction failed:', error); return false; }
}

export interface OrderPreviewRecord { recommendationId: number | null; accountExternalId: string; broker: string; symbol: string; side: string; notional: number | null; quantity: number | null; orderType: string; limitPrice: number | null; origin: string; sleeve: string; rationale: string; approvedByRisk: boolean; allowedNotional: number; findings: unknown; impact: unknown; }

export async function saveOrderPreviews(records: OrderPreviewRecord[]): Promise<number[]> {
  const db = getDb(); if (!db || !records.length) return [];
  try {
    const rows = await db.insert(schema.orderPreviews).values(records.map((r) => ({ recommendationId: r.recommendationId, accountExternalId: r.accountExternalId, broker: r.broker, symbol: r.symbol, side: r.side, notional: r.notional, quantity: r.quantity, orderType: r.orderType, limitPrice: r.limitPrice, origin: r.origin, sleeve: r.sleeve, rationale: r.rationale, approvedByRisk: r.approvedByRisk, allowedNotional: r.allowedNotional, findings: r.findings as object, impact: r.impact as object, status: 'preview' }))).returning({ id: schema.orderPreviews.id });
    return rows.map((row) => row.id);
  } catch (error) { console.error('[dahcorp] saveOrderPreviews failed:', error); return []; }
}

export async function claimOrderPreview(id: number) {
  const db = getDb(); if (!db) return null;
  const cutoff = new Date(Date.now() - 5 * 60_000);
  try { const rows = await db.update(schema.orderPreviews).set({ status: 'approved' }).where(and(eq(schema.orderPreviews.id, id), eq(schema.orderPreviews.status, 'preview'), eq(schema.orderPreviews.approvedByRisk, true), gt(schema.orderPreviews.createdAt, cutoff))).returning(); return rows[0] ?? null; }
  catch (error) { console.error('[dahcorp] claimOrderPreview failed:', error); return null; }
}

export async function setOrderPreviewStatus(id: number, status: string): Promise<void> {
  const db = getDb(); if (!db) return;
  try { await db.update(schema.orderPreviews).set({ status }).where(eq(schema.orderPreviews.id, id)); }
  catch (error) { console.error('[dahcorp] setOrderPreviewStatus failed:', error); }
}

export async function listOrderPreviews(limit = 25) {
  const db = getDb(); if (!db) return [];
  try { return await db.select().from(schema.orderPreviews).orderBy(desc(schema.orderPreviews.createdAt)).limit(limit); }
  catch (error) { console.error('[dahcorp] listOrderPreviews failed:', error); return []; }
}
