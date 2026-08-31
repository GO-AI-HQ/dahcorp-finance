import type { PortfolioSnapshot } from '../../src/core/types.js';
import type { StrategyConfig } from '../../src/core/config.js';
import type { BrokerStatus } from '../../src/brokers/registry.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import { buildAnalysisContext, type AnalysisContext } from '../../src/services/analysis.js';
import { buildPortfolioSnapshot } from '../../src/services/snapshot.js';
import { createDataPlaneSnapshot, type DataPlaneProviderId, type SnapshotFreshness } from '../../src/data/dataPlane.js';
import {
  applyExternalLiquiditySemantics,
  buildBrokerStateBasis,
  buildLiveMarketProviderForSource,
  type BrokerStateBasis,
} from './context.mts';
import { loadDataPlaneSnapshot, saveDataPlaneSnapshot } from './dataPlaneSnapshotStore.mts';
import { loadPreparedMarketPayload, loadPreparedMarketProvider } from './preparedMarketSnapshot.mts';

const HOUR = 60 * 60_000;

export type PreparedPortfolioMarketReadMode = 'prepared_market' | 'live_market_bootstrap_fallback';

export interface PreparedPortfolioPayload {
  version: 'portfolio-v1';
  snapshot: PortfolioSnapshot;
  config: StrategyConfig;
  configPersisted: boolean;
  configNote: string | null;
  brokers: BrokerStatus[];
  builtAt: string;
  marketReadMode?: PreparedPortfolioMarketReadMode;
}

export interface PreparedAnalysisContext extends AnalysisContext {
  configPersisted: boolean;
  configNote: string | null;
  brokers: BrokerStatus[];
  preparedAt: string;
  preparedFreshness: SnapshotFreshness;
  preparedMarketReadMode: PreparedPortfolioMarketReadMode | 'unknown_legacy';
}

function isPreparedPortfolioPayload(value: unknown): value is PreparedPortfolioPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PreparedPortfolioPayload>;
  return row.version === 'portfolio-v1'
    && typeof row.builtAt === 'string'
    && Boolean(row.snapshot)
    && Boolean(row.config)
    && Array.isArray(row.brokers)
    && (row.marketReadMode == null || row.marketReadMode === 'prepared_market' || row.marketReadMode === 'live_market_bootstrap_fallback');
}

function addProviderFromId(providers: Set<DataPlaneProviderId>, raw: string): void {
  const id = raw.toLowerCase();
  if (id.includes('schwab')) providers.add('schwab');
  if (id.includes('robinhood')) providers.add('robinhood');
  if (id.includes('openbb')) providers.add('openbb');
  if (id.includes('fmp')) providers.add('fmp');
}

function providersForBasis(basis: BrokerStateBasis, liveFallbackProvider: MarketDataProvider | null): DataPlaneProviderId[] {
  const providers = new Set<DataPlaneProviderId>();
  for (const account of basis.source.accounts) {
    if (account.broker === 'schwab') providers.add('schwab');
    if (account.broker === 'robinhood') providers.add('robinhood');
    if (account.broker === 'manual') providers.add('manual');
  }
  // Prepared market evidence is independently attributed in the Market
  // Snapshot. Only add a market provider here when this refresh had to use the
  // explicit live bootstrap fallback because no usable Market Snapshot existed.
  if (liveFallbackProvider) addProviderFromId(providers, liveFallbackProvider.id);
  return [...providers];
}

/**
 * Refresh the broker/account basis once per hour and compose it with the latest
 * independently prepared market evidence. In the normal path this function
 * makes broker/account calls only; quote/history/distribution provider calls
 * remain owned by their dedicated market refresh tiers.
 *
 * A live market provider is used only as a cold-start/bootstrap fallback when
 * no usable Prepared Market Snapshot exists yet.
 */
export async function refreshPreparedPortfolioSnapshot(): Promise<{
  payload: PreparedPortfolioPayload;
  persisted: boolean;
}> {
  const basis = await buildBrokerStateBasis();
  const preparedProvider = await loadPreparedMarketProvider();
  const liveFallbackProvider = preparedProvider
    ? null
    : buildLiveMarketProviderForSource(basis.adapters, basis.config, basis.source);
  const provider = preparedProvider ?? liveFallbackProvider!;
  const marketReadMode: PreparedPortfolioMarketReadMode = preparedProvider
    ? 'prepared_market'
    : 'live_market_bootstrap_fallback';
  const snapshot = await buildPortfolioSnapshot({ asOf: basis.asOf, provider, source: basis.source });
  const builtAt = new Date().toISOString();
  const payload: PreparedPortfolioPayload = {
    version: 'portfolio-v1',
    snapshot,
    config: basis.config,
    configPersisted: basis.configPersisted,
    configNote: basis.configNote,
    brokers: basis.brokers,
    builtAt,
    marketReadMode,
  };

  const providers = providersForBasis(basis, liveFallbackProvider);
  const hasPortfolioState = snapshot.accounts.length > 0 && snapshot.holdings.length > 0;
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
    usable: hasPortfolioState && !snapshot.containsMockData,
    containsMockData: snapshot.containsMockData,
    notes: [
      'Prepared Portfolio Snapshot is a display/analysis basis, not execution state.',
      marketReadMode === 'prepared_market'
        ? 'Broker/account state was composed with the Prepared Market Snapshot; this hourly portfolio refresh made no market-provider calls.'
        : 'No usable Prepared Market Snapshot existed, so this refresh used the controlled live market bootstrap fallback.',
      'Market evidence may be replaced at read time by the independently refreshed Market Snapshot.',
      'A future order must revalidate broker cash, holdings, quote and deterministic risk immediately before submission.',
      ...snapshot.sourceNotes,
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
  const analysis = applyExternalLiquiditySemantics(buildAnalysisContext(snapshot, payload.config), payload.config);

  return {
    ...analysis,
    configPersisted: payload.configPersisted,
    configNote: payload.configNote,
    brokers: payload.brokers,
    preparedAt: loaded.snapshot.observedAt,
    preparedFreshness: loaded.freshness,
    preparedMarketReadMode: payload.marketReadMode ?? 'unknown_legacy',
  };
}
