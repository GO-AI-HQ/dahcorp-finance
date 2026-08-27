/**
 * Per-request server context.
 *
 * Assembles the strategy config, the position source, the market-data provider
 * and the derived analysis in one place so each function stays small and every
 * function sees exactly the same numbers.
 */
import { buildAnalysisContext, type AnalysisContext } from '../../src/services/analysis.js';
import { buildPortfolioSnapshot, seedPositionSource } from '../../src/services/snapshot.js';
import { mockMarketDataProvider } from '../../src/market/mockProvider.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import { buildBrokerRegistry, describeBrokers, type BrokerStatus } from '../../src/brokers/registry.js';
import type { BrokerAccountData } from '../../src/brokers/types.js';
import { loadPositionSource, loadStrategyConfig } from './store.mts';
import type { StrategyConfig } from '../../src/core/config.js';

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface ServerContext extends AnalysisContext {
  configPersisted: boolean;
  configNote: string | null;
  provider: MarketDataProvider;
  brokers: BrokerStatus[];
}

/**
 * The market-data provider. Only the mock generator exists in this build; a live
 * vendor slots in here without touching any calculation, risk or UI code.
 */
export function selectMarketProvider(env: NodeJS.ProcessEnv = process.env): MarketDataProvider {
  const configured = (env.MARKET_DATA_PROVIDER ?? 'mock').toLowerCase();
  if (configured !== 'mock') {
    console.warn(`[dahcorp] MARKET_DATA_PROVIDER="${configured}" is not implemented; using the mock provider.`);
  }
  return mockMarketDataProvider;
}

export async function buildServerContext(options: { asOf?: string } = {}): Promise<ServerContext> {
  const asOf = options.asOf ?? todayISO();
  const [{ config, persisted, note }, source] = await Promise.all([loadStrategyConfig(), loadPositionSource(asOf)]);
  const provider = selectMarketProvider();

  const snapshot = await buildPortfolioSnapshot({ asOf, provider, source });
  const analysisContext = buildAnalysisContext(snapshot, config);

  // Broker adapters are constructed with a read-only view of the assembled
  // model so they never import fixtures or reach into the database themselves.
  const fallback = (broker: 'robinhood' | 'schwab'): BrokerAccountData => ({
    accounts: snapshot.accounts.filter((a) => a.broker === broker),
    holdings: snapshot.holdings.filter((h) =>
      snapshot.accounts.some((a) => a.id === h.accountId && a.broker === broker),
    ),
    asOf: snapshot.asOf,
  });
  const adapters = buildBrokerRegistry(process.env as Record<string, string | undefined>, fallback);

  return {
    ...analysisContext,
    configPersisted: persisted,
    configNote: note,
    provider,
    brokers: describeBrokers(adapters, process.env as Record<string, string | undefined>),
  };
}

/** Config-only context, for endpoints that do not need market data. */
export async function loadConfigOnly(): Promise<{ config: StrategyConfig; persisted: boolean; note: string | null }> {
  const { config, persisted, note } = await loadStrategyConfig();
  return { config, persisted, note };
}

export { seedPositionSource };
