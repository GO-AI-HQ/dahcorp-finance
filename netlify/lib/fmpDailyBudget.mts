import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';

const DEFAULT_DAILY_BUDGET = 60;
const MAX_CONFIGURABLE_BUDGET = 200;
const BUDGET_KEY_PREFIX = 'provider_budget:fmp:';

type RuntimeEnv = Record<string, string | undefined>;

function envValue(key: string, env?: RuntimeEnv): string | undefined {
  if (env?.[key] != null) return env[key];
  if (typeof process !== 'undefined' && process.env?.[key] != null) return process.env[key];
  try {
    const netlify = (globalThis as typeof globalThis & { Netlify?: { env?: { get?: (name: string) => string | undefined } } }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

export function fmpDailyBudgetLimit(env?: RuntimeEnv): number {
  const parsed = Number(envValue('FMP_DAILY_CALL_BUDGET', env));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAILY_BUDGET;
  return Math.min(MAX_CONFIGURABLE_BUDGET, Math.max(1, Math.floor(parsed)));
}

export interface FmpBudgetStatus {
  day: string;
  used: number;
  limit: number;
  remaining: number;
  available: boolean;
  reserved: boolean;
  note: string;
}

function parseBudgetValue(value: unknown, day: string, limit: number, reserved = false): FmpBudgetStatus {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const usedRaw = Number(row.used);
  const used = Number.isFinite(usedRaw) && usedRaw >= 0 ? Math.floor(usedRaw) : 0;
  const remaining = Math.max(0, limit - used);
  return {
    day,
    used,
    limit,
    remaining,
    available: used < limit,
    reserved,
    note: used >= limit
      ? `DAHCorp's FMP safety budget is exhausted for ${day}. Stored data and OpenBB fallbacks remain available.`
      : `DAHCorp has ${remaining} FMP call${remaining === 1 ? '' : 's'} left in its ${limit}-call safety budget for ${day}.`,
  };
}

function blockedStatus(day: string, limit: number, note: string): FmpBudgetStatus {
  return { day, used: 0, limit, remaining: 0, available: false, reserved: false, note };
}

export async function getFmpDailyBudgetStatus(env?: RuntimeEnv, now = new Date()): Promise<FmpBudgetStatus> {
  const day = now.toISOString().slice(0, 10);
  const limit = fmpDailyBudgetLimit(env);
  const db = getDb();
  if (!db) return blockedStatus(day, limit, 'The persistent budget store is unavailable, so DAHCorp will not make FMP network calls.');

  try {
    const key = `${BUDGET_KEY_PREFIX}${day}`;
    const rows = await db.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
    return parseBudgetValue(rows[0]?.value, day, limit);
  } catch (error) {
    console.error('[dahcorp] getFmpDailyBudgetStatus failed:', error);
    return blockedStatus(day, limit, 'The FMP safety budget could not be verified, so DAHCorp will not make an FMP network call.');
  }
}

/**
 * Atomically reserve one provider call before any FMP request leaves DAHCorp.
 *
 * The counter is persisted in the existing settings table, so separate Netlify
 * function instances and retries share the same daily ceiling. If the database
 * is unavailable or the reservation cannot be verified, this fails closed:
 * callers must use stored evidence or another provider instead of spending an
 * untracked FMP call.
 */
export async function reserveFmpCall(purpose: string, env?: RuntimeEnv, now = new Date()): Promise<FmpBudgetStatus> {
  const day = now.toISOString().slice(0, 10);
  const limit = fmpDailyBudgetLimit(env);
  const db = getDb();
  if (!db) return blockedStatus(day, limit, 'The persistent budget store is unavailable, so DAHCorp blocked the FMP provider request.');

  const key = `${BUDGET_KEY_PREFIX}${day}`;
  const safePurpose = purpose.slice(0, 80);
  const initialValue = JSON.stringify({ day, used: 1, limit, lastPurpose: safePurpose });
  try {
    const result = await db.execute(sql`
      INSERT INTO ${schema.settings} ("key", "value", "updated_at")
      VALUES (${key}, ${initialValue}::jsonb, NOW())
      ON CONFLICT ("key") DO UPDATE
      SET "value" = jsonb_build_object(
            'day', ${day},
            'used', COALESCE((${schema.settings.value}->>'used')::integer, 0) + 1,
            'limit', ${limit},
            'lastPurpose', ${safePurpose}
          ),
          "updated_at" = NOW()
      WHERE COALESCE((${schema.settings.value}->>'used')::integer, 0) < ${limit}
      RETURNING "value"
    `);
    const rows = (result as unknown as { rows?: Array<{ value?: unknown }> }).rows ?? [];
    if (rows.length) return parseBudgetValue(rows[0]?.value, day, limit, true);
    return await getFmpDailyBudgetStatus(env, now);
  } catch (error) {
    console.error('[dahcorp] reserveFmpCall failed:', error);
    return blockedStatus(day, limit, 'The FMP safety budget could not reserve a call, so DAHCorp blocked the provider request.');
  }
}
