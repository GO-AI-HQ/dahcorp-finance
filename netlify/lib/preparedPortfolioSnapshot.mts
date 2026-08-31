import type { PortfolioSnapshot } from '../../src/core/types.js';
import type { StrategyConfig } from '../../src/core/config.js';
import type { BrokerStatus } from '../../src/brokers/registry.js';
import { buildAnalysisContext, type AnalysisContext } from '../../src/services/analysis.js';
import { createDataPlaneSnapshot, type DataPlaneProviderId, type SnapshotFreshness } from '../../src/data/dataPlane.js';
import { buildServerContext } from './context.mts';
import { loadDataPlaneSnapshot, saveDataPlaneSnapshot } from './dataPlaneSnapshotStore.mts';

const HOUR = 60 * 60_000;

export interface PreparedPortfolioPayload {
  version: 'portfolio-v1';
  snapshot: PortfolioSnapshot;
  config: StrategyConfig;
  configPersisted: boolean;
  configNote: string | null;
  brokers: BrokerStatus[];
  builtAt: string;
}

export interface PreparedAnalysisContext extends AnalysisContext {
  configPersisted: boolean;
  configNote: string | null;
  brokers: BrokerStatus[];
  preparedAt: string;
  preparedFreshness: SnapshotFreshness;
}

function isPreparedPortfolioPayload(value: unknown): value is PreparedPortfolioPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PreparedPortfolioPayload>;
  return row.version === 'portfolio-v1'
    && typeof row.builtAt === 'string'
    && Boolean(row.snapshot)
    && Boolean(row.config)
    && Array.isArray(row.brokers);
}

function providersForContext(ctx: Awaited<ReturnType<typeof buildServerContext>>): DataPlaneProviderId[] {
  const providers = new Set<DataPlaneProviderId>();
  for (const account of ctx.snapshot.accounts) {
    if (account.broker === 'schwab') providers.add('schwab');
    if (account.broker === 'robinhood') providers.add('robinhood');
    if (account.broker === 'manual') providers.add('manual');
  }
  const providerId = ctx.provider.id.toLowerCase();
  if (providerId.includes('schwab')) providers.add('schwab');
  if (providerId.includes('openbb')) providers.add('openbb');
  if (providerId.includes('fmp')) providers.add('fmp');
  return [...providers];
}

/**
 * Build the complete expensive portfolio/market analysis basis once in a
 * background refresh and atomically persist it. Interactive consumers will be
 * migrated to this prepared state after the refresh path is proven stable.
 */
export async function refreshPreparedPortfolioSnapshot(): Promise<{
  payload: PreparedPortfolioPayload;
  persisted: boolean;
}> {
  const ctx = await buildServerContext();
  const builtAt = new Date().toISOString();
  const payload: PreparedPortfolioPayload = {
    version: 'portfolio-v1',
    snapshot: ctx.snapshot,
    config: ctx.config,
    configPersisted: ctx.configPersisted,
    configNote: ctx.configNote,
    brokers: ctx.brokers,
    builtAt,
  };

  const providers = providersForContext(ctx);
  const hasPortfolioState = ctx.snapshot.accounts.length > 0 && ctx.snapshot.holdings.length > 0;
  const persisted = await saveDataPlaneSnapshot(createDataPlaneSnapshot({
    domain: 'portfolio',
    observedAt: builtAt,
    capturedAt: builtAt,
    providers,
    primaryProvider: null,
    mode: providers.length > 1 ? 'composed' : 'live',
    // Transitional composite cadence. Quote/history refresh will be split into
    // its own Market Snapshot before execution-adjacent use is considered.
    freshnessPolicy: { freshForMs: 75 * 60_000, staleUsableForMs: 6 * HOUR },
    payload,
    usable: hasPortfolioState && !ctx.snapshot.containsMockData,
    containsMockData: ctx.snapshot.containsMockData,
    notes: [
      'Prepared Portfolio Snapshot is a display/analysis basis, not execution state.',
      'A future order must revalidate broker cash, holdings, quote and deterministic risk immediately before submission.',
      ...ctx.snapshot.sourceNotes,
    ],
  }));

  return { payload, persisted };
}

/**
 * Read-only reconstruction of deterministic analysis from a prepared snapshot.
 * It performs zero broker/provider calls. Retained evidence is explicitly marked
 * stale in the reconstructed PortfolioSnapshot so downstream UI/model context
 * cannot mistake continuity for a live refresh.
 */
export async function loadPreparedAnalysisContext(now: Date = new Date()): Promise<PreparedAnalysisContext | null> {
  const loaded = await loadDataPlaneSnapshot<PreparedPortfolioPayload>('portfolio', now);
  if (!loaded || (loaded.freshness !== 'fresh' && loaded.freshness !== 'stale_usable')) return null;
  if (!loaded.snapshot.quality.usable || !isPreparedPortfolioPayload(loaded.snapshot.payload)) return null;

  const payload = loaded.snapshot.payload;
  const retained = loaded.freshness === 'stale_usable';
  const snapshot: PortfolioSnapshot = retained ? {
    ...payload.snapshot,
    dataQuality: payload.snapshot.containsMockData ? 'mock' : 'stale',
    sourceNotes: [...new Set([
      ...payload.snapshot.sourceNotes,
      `Prepared portfolio evidence is retained from ${loaded.snapshot.observedAt}; the latest background refresh has not yet replaced it.`,
    ])],
  } : payload.snapshot;
  const analysis = buildAnalysisContext(snapshot, payload.config);

  return {
    ...analysis,
    configPersisted: payload.configPersisted,
    configNote: payload.configNote,
    brokers: payload.brokers,
    preparedAt: loaded.snapshot.observedAt,
    preparedFreshness: loaded.freshness,
  };
}
