import type { AnalysisContext } from '../../src/services/analysis.js';
import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { createDataPlaneSnapshot } from '../../src/data/dataPlane.js';
import { latestIntelligenceEventByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';
import { loadDataPlaneSnapshot, saveDataPlaneSnapshot } from './dataPlaneSnapshotStore.mts';

const PURPOSE = 'strategy_lab_income_basis';
const MAX_FALLBACK_AGE_HOURS = 72;
const FRESH_LOCK_HOURS = 1;
const HOUR = 3_600_000;

export type StrategyLabBasisStatus = 'current' | 'recent_verified' | 'unavailable';

export interface StrategyLabBasis {
  rate: number | null;
  asOf: string | null;
  status: StrategyLabBasisStatus;
  note: string;
}

interface StrategyBasisSnapshotPayload {
  version: 'strategy-basis-v1';
  rate: number;
  portfolioAsOf: string;
  calculationScope: string;
  distributionBasis: string;
  incomeEngineCapital: number;
  conservativeRate: number | null;
  referenceSharePrice: number | null;
  builtAt: string;
}

function positiveRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function ageHours(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / HOUR) : Number.POSITIVE_INFINITY;
}

function basisMatchesConfig(
  calculationScope: unknown,
  distributionBasis: unknown,
  ctx: AnalysisContext,
): boolean {
  return calculationScope === ctx.config.calculationScope
    && distributionBasis === ctx.config.distributionBasis;
}

function matchingStoredBasis(event: IntelligenceEvent | null, ctx: AnalysisContext): { rate: number; asOf: string; ageHours: number } | null {
  if (!event || event.metadata?.purpose !== PURPOSE) return null;
  if (!basisMatchesConfig(event.metadata.calculationScope, event.metadata.distributionBasis, ctx)) return null;
  const rate = positiveRate(event.metadata.rate);
  const asOf = typeof event.metadata.basisAsOf === 'string' ? event.metadata.basisAsOf : event.discoveredAt;
  if (rate == null) return null;
  return { rate, asOf, ageHours: ageHours(asOf) };
}

function isStrategyBasisSnapshotPayload(value: unknown): value is StrategyBasisSnapshotPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StrategyBasisSnapshotPayload>;
  return row.version === 'strategy-basis-v1'
    && positiveRate(row.rate) != null
    && typeof row.portfolioAsOf === 'string'
    && typeof row.calculationScope === 'string'
    && typeof row.distributionBasis === 'string'
    && typeof row.builtAt === 'string';
}

async function matchingDataPlaneBasis(ctx: AnalysisContext): Promise<{ rate: number; asOf: string; ageHours: number } | null> {
  const loaded = await loadDataPlaneSnapshot<StrategyBasisSnapshotPayload>('strategy_basis');
  if (!loaded || (loaded.freshness !== 'fresh' && loaded.freshness !== 'stale_usable')) return null;
  const value = loaded.snapshot.payload;
  if (!isStrategyBasisSnapshotPayload(value)) return null;
  if (!basisMatchesConfig(value.calculationScope, value.distributionBasis, ctx)) return null;
  return { rate: value.rate, asOf: value.builtAt, ageHours: ageHours(value.builtAt) };
}

async function persistBasis(ctx: AnalysisContext, rate: number): Promise<void> {
  const now = new Date().toISOString();
  const payload: StrategyBasisSnapshotPayload = {
    version: 'strategy-basis-v1',
    rate,
    portfolioAsOf: ctx.snapshot.asOf,
    calculationScope: ctx.config.calculationScope,
    distributionBasis: ctx.config.distributionBasis,
    incomeEngineCapital: ctx.income.incomeEngineCapital,
    conservativeRate: positiveRate(ctx.income.blendedConservativeRate),
    referenceSharePrice: ctx.income.positions[0]?.price ?? null,
    builtAt: now,
  };

  await saveDataPlaneSnapshot(createDataPlaneSnapshot({
    domain: 'strategy_basis',
    observedAt: now,
    capturedAt: now,
    providers: [],
    primaryProvider: null,
    mode: 'composed',
    freshnessPolicy: { freshForMs: FRESH_LOCK_HOURS * HOUR, staleUsableForMs: MAX_FALLBACK_AGE_HOURS * HOUR },
    payload,
    containsMockData: ctx.snapshot.containsMockData,
    usable: !ctx.snapshot.containsMockData,
    notes: [
      'Strategy Basis Snapshot contains verified planning inputs only; slider changes are deterministic projections against this stored basis.',
      'Planning evidence is never an execution quote or permission to place an order.',
    ],
  }));

  const event: IntelligenceEvent = {
    fingerprint: `strategy-lab-basis-${ctx.config.calculationScope}-${ctx.config.distributionBasis}`,
    occurredAt: now,
    discoveredAt: now,
    source: 'DAHCorp verified income model basis',
    sourceClass: 'market_benchmark',
    sourceUrl: null,
    sourceQuality: 0.95,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: 'Strategy Lab verified income basis updated',
    summary: 'A verified portfolio distribution rate was stored so planning sliders remain stable between provider refreshes.',
    symbols: ctx.income.positions.map((position) => position.symbol),
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: {
      purpose: PURPOSE,
      rate,
      basisAsOf: now,
      portfolioAsOf: ctx.snapshot.asOf,
      calculationScope: ctx.config.calculationScope,
      distributionBasis: ctx.config.distributionBasis,
      rule: 'Planning may reuse this verified rate for up to 72 hours when a provider temporarily fails. It is never substituted for execution pricing.',
    },
  };
  await persistIntelligenceEvents([event]);
}

/**
 * Resolve a stable planning basis. The Data Plane Strategy Basis Snapshot is the
 * first read; the legacy intelligence event remains as backward-compatible
 * evidence during the migration. A current verified portfolio rate refreshes
 * both stores when the one-hour lock expires.
 */
export async function resolveStrategyLabBasis(ctx: AnalysisContext): Promise<StrategyLabBasis> {
  const currentRate = positiveRate(ctx.income.blendedDistributionRate);
  const [dataPlaneStored, eventStored] = await Promise.all([
    matchingDataPlaneBasis(ctx),
    latestIntelligenceEventByPurpose(PURPOSE).then((event) => matchingStoredBasis(event, ctx)),
  ]);
  const stored = [dataPlaneStored, eventStored]
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.ageHours - b.ageHours)[0] ?? null;

  if (stored && stored.ageHours <= FRESH_LOCK_HOURS) {
    return {
      rate: stored.rate,
      asOf: stored.asOf,
      status: currentRate != null ? 'current' : 'recent_verified',
      note: currentRate != null
        ? 'Using the verified Strategy Basis Snapshot already opened by Strategy Lab so slider changes compare the same starting assumptions.'
        : 'The newest portfolio evidence is incomplete, so Strategy Lab kept the verified basis it was already using.',
    };
  }

  if (currentRate != null) {
    await persistBasis(ctx, currentRate);
    return {
      rate: currentRate,
      asOf: new Date().toISOString(),
      status: 'current',
      note: 'Using the current verified portfolio distribution history and persisting it as the Strategy Basis Snapshot.',
    };
  }

  if (stored && stored.ageHours <= MAX_FALLBACK_AGE_HOURS) {
    return {
      rate: stored.rate,
      asOf: stored.asOf,
      status: 'recent_verified',
      note: 'Current income data is temporarily incomplete. Strategy Lab is using the most recent verified Strategy Basis Snapshot instead of dropping the model to zero.',
    };
  }

  return {
    rate: null,
    asOf: null,
    status: 'unavailable',
    note: 'No current or recent verified income basis is available. Strategy Lab will wait rather than guess a yield.',
  };
}
