import type { ServerContext } from './context.mts';
import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { latestIntelligenceEventByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';

const PURPOSE = 'strategy_lab_income_basis';
const MAX_FALLBACK_AGE_HOURS = 72;
const FRESH_LOCK_HOURS = 1;

export type StrategyLabBasisStatus = 'current' | 'recent_verified' | 'unavailable';

export interface StrategyLabBasis {
  rate: number | null;
  asOf: string | null;
  status: StrategyLabBasisStatus;
  note: string;
}

function positiveRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function ageHours(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3_600_000) : Number.POSITIVE_INFINITY;
}

function matchingStoredBasis(event: IntelligenceEvent | null, ctx: ServerContext): { rate: number; asOf: string; ageHours: number } | null {
  if (!event || event.metadata?.purpose !== PURPOSE) return null;
  if (event.metadata.calculationScope !== ctx.config.calculationScope) return null;
  if (event.metadata.distributionBasis !== ctx.config.distributionBasis) return null;
  const rate = positiveRate(event.metadata.rate);
  const asOf = typeof event.metadata.basisAsOf === 'string' ? event.metadata.basisAsOf : event.discoveredAt;
  if (rate == null) return null;
  return { rate, asOf, ageHours: ageHours(asOf) };
}

async function persistBasis(ctx: ServerContext, rate: number): Promise<void> {
  const now = new Date().toISOString();
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
 * Resolve a stable planning basis. A very recent verified basis is preferred for
 * one hour so repeated slider calls do not move the goal line underneath the
 * user. After that, a fresh verified portfolio rate replaces it. If a provider
 * temporarily fails, the last matching verified basis may be reused for up to
 * 72 hours and is explicitly labeled recent_verified rather than live.
 */
export async function resolveStrategyLabBasis(ctx: ServerContext): Promise<StrategyLabBasis> {
  const currentRate = positiveRate(ctx.income.blendedDistributionRate);
  const stored = matchingStoredBasis(await latestIntelligenceEventByPurpose(PURPOSE), ctx);

  if (stored && stored.ageHours <= FRESH_LOCK_HOURS) {
    return {
      rate: stored.rate,
      asOf: stored.asOf,
      status: currentRate != null ? 'current' : 'recent_verified',
      note: currentRate != null
        ? 'Using the verified income basis already opened by Strategy Lab so slider changes compare the same starting assumptions.'
        : 'The live provider missed this request, so Strategy Lab kept the verified basis it was already using.',
    };
  }

  if (currentRate != null) {
    await persistBasis(ctx, currentRate);
    return {
      rate: currentRate,
      asOf: new Date().toISOString(),
      status: 'current',
      note: 'Using the current verified portfolio distribution history.',
    };
  }

  if (stored && stored.ageHours <= MAX_FALLBACK_AGE_HOURS) {
    return {
      rate: stored.rate,
      asOf: stored.asOf,
      status: 'recent_verified',
      note: 'Current income data is temporarily incomplete. Strategy Lab is using the most recent verified basis instead of dropping the model to zero.',
    };
  }

  return {
    rate: null,
    asOf: null,
    status: 'unavailable',
    note: 'No current or recent verified income basis is available. Strategy Lab will wait rather than guess a yield.',
  };
}
