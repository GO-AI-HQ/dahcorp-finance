import type { PortfolioSnapshot } from '../../src/core/types.js';
import type { StrategyConfig } from '../../src/core/config.js';
import type { BrokerStatus } from '../../src/brokers/registry.js';
import { buildAnalysisContext, type AnalysisContext } from '../../src/services/analysis.js';
import { createDataPlaneSnapshot, type DataPlaneProviderId, type SnapshotFreshness } from '../../src/data/dataPlane.js';
import { buildServerContext } from './context.mts';
import { loadDataPlaneSnapshot, saveDataPlaneSnapshot } from './dataPlaneSnapshotStore.mts';
import { loadPreparedMarketPayload } from './preparedMarketSnapshot.mts';

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
 * background refresh and atomically persist it. Interactive consumers read this
 * prepared state; the independently refreshed Market Snapshot is overlaid at
 * read time so quote/history/distribution cadence is no longer tied to page
 * navigation or to the broker snapshot cadence.
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
    // Broker/account continuity window. Market evidence has its own independent
    // per-family freshness rules and is overlaid when this snapshot is read.
    freshnessPolicy: { freshForMs: 75 * 60_000, staleUsableForMs: 6 * HOUR },
    payload,
    usable: hasPortfolioState && !ctx.snapshot.containsMockData,
    containsMockData: ctx.snapshot.containsMockData,
    notes: [
      'Prepared Portfolio Snapshot is a display/analysis basis, not execution state.',
      'Market evidence may be replaced at read time by the independently refreshed Market Snapshot.',
      'A future order must revalidate broker cash, holdings, quote and deterministic risk immediately before submission.',
      ...ctx.snapshot.sourceNotes,
    ],
  }));

  return { payload, persisted };
}

/**
 * Read-only reconstruction of deterministic analysis from prepared snapshots.
 * It performs zero broker/provider calls. The portfolio/broker basis and market
 * evidence are refreshed on separate schedules, then joined locally here.
 */
export async function loadPreparedAnalysisContext(now: Date = new Date()): Promise<PreparedAnalysisContext | null> {
  const loaded = await loadDataPlaneSnapshot<PreparedPortfolioPayload>('portfolio', now);
  if (!loaded || (loaded.freshness !== 'fresh' && loaded.freshness !== 'stale_usable')) return null;
  if (!loaded.snapshot.quality.usable || !isPreparedPortfolioPayload(loaded.snapshot.payload)) return null;

  const payload = loaded.snapshot.payload;
  const market = await loadPreparedMarketPayload(now);
  const portfolioRetained = loaded.freshness === 'stale_usable';
  const marketRetained = market?.freshness === 'stale_usable';
  const marketDistributionSymbols = new Set(market?.payload.evidence.distributions.map((row) => row.symbol.toUpperCase()) ?? []);

  const mergedDistributions = market
    ? [
        ...payload.snapshot.distributions.filter((row) => !marketDistributionSymbols.has(row.symbol.toUpperCase())),
        ...market.payload.distributions,
      ].sort((a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol))
    : payload.snapshot.distributions;

  const containsMockData = payload.snapshot.containsMockData || Boolean(market?.containsMockData);
  const snapshot: PortfolioSnapshot = {
    ...payload.snapshot,
    quotes: market ? { ...payload.snapshot.quotes, ...market.payload.quotes } : payload.snapshot.quotes,
    priceHistory: market ? { ...payload.snapshot.priceHistory, ...market.payload.priceHistory } : payload.snapshot.priceHistory,
    distributions: mergedDistributions,
    containsMockData,
    dataQuality: containsMockData
      ? 'mock'
      : portfolioRetained || marketRetained
        ? 'stale'
        : payload.snapshot.dataQuality,
    sourceNotes: [...new Set([
      ...payload.snapshot.sourceNotes,
      ...(market?.notes ?? []),
      ...(market ? [`Prepared Market Snapshot composed at ${market.payload.builtAt}; quote/history/distribution evidence is joined locally without provider calls.`] : []),
      ...(portfolioRetained ? [`Prepared portfolio evidence is retained from ${loaded.snapshot.observedAt}; the latest background broker refresh has not yet replaced it.`] : []),
      ...(marketRetained ? ['Prepared market composition is retained last-known-good; each included symbol still satisfies its own evidence-family stale-usable policy.'] : []),
    ])],
  };
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
