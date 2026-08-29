/**
 * Per-request server context.
 *
 * Assembles the strategy config, live broker state, market-data provider and the
 * derived analysis in one place so every function sees the same numbers.
 */
import { buildAnalysisContext, type AnalysisContext } from '../../src/services/analysis.js';
import { buildPortfolioSnapshot, seedPositionSource, type PositionSource } from '../../src/services/snapshot.js';
import { mockMarketDataProvider } from '../../src/market/mockProvider.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import { buildBrokerRegistry, describeBrokers, type BrokerStatus } from '../../src/brokers/registry.js';
import type { BrokerAccountData, BrokerAdapter } from '../../src/brokers/types.js';
import type { BrokerId } from '../../src/core/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { loadPositionSource, loadStrategyConfig } from './store.mts';
import type { StrategyConfig } from '../../src/core/config.js';
import { loadSchwabRefreshToken, saveSchwabRefreshToken } from './schwabTokens.mts';
import { createRobinhoodGateway } from './robinhoodMcp.mts';
import { SchwabHybridMarketDataProvider } from './schwabMarketProvider.mts';
import type { SchwabAdapter } from '../../src/brokers/schwab/adapter.js';

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface ServerContext extends AnalysisContext {
  configPersisted: boolean;
  configNote: string | null;
  provider: MarketDataProvider;
  brokers: BrokerStatus[];
  /** Server-only adapter instances. Never serialise this property. */
  adapters: BrokerAdapter[];
}

function fallbackFromSource(source: PositionSource, broker: 'robinhood' | 'schwab'): BrokerAccountData {
  const ids = new Set(source.accounts.filter((account) => account.broker === broker).map((account) => account.id));
  return {
    accounts: source.accounts.filter((account) => account.broker === broker),
    holdings: source.holdings.filter((holding) => ids.has(holding.accountId)),
    asOf: new Date().toISOString(),
  };
}

/**
 * Replace stored/seed broker rows with the broker's own current account state.
 * A broker failure never erases the prior source; it leaves that lane unchanged
 * and adds a provenance note. Seed-only manual fixtures are dropped once at
 * least one real brokerage is live, because demonstration assets must not sit
 * beside real money as though they were part of the investor's balance sheet.
 */
async function convergeLiveBrokerState(source: PositionSource, adapters: BrokerAdapter[]): Promise<PositionSource> {
  let accounts = source.origin === 'seed' ? source.accounts.filter((account) => account.broker !== 'manual') : [...source.accounts];
  let holdings = source.origin === 'seed'
    ? source.holdings.filter((holding) => accounts.some((account) => account.id === holding.accountId))
    : [...source.holdings];
  const notes = [...source.notes];
  const liveBrokers = new Set<BrokerId>();

  for (const adapter of adapters) {
    if (!adapter.isConfigured() || !adapter.capabilities.includes('read_accounts')) continue;
    try {
      const auth = await adapter.authenticate();
      if (!auth.ok) {
        notes.push(`${adapter.label} live portfolio state was not used: ${auth.message}`);
        continue;
      }
      const data = await adapter.getAccountData();
      if (!data.accounts.length) {
        notes.push(`${adapter.label} authenticated but returned no accounts; the prior source was retained for that lane.`);
        continue;
      }

      const oldIds = new Set(accounts.filter((account) => account.broker === adapter.id).map((account) => account.id));
      accounts = accounts.filter((account) => account.broker !== adapter.id);
      holdings = holdings.filter((holding) => !oldIds.has(holding.accountId));
      accounts.push(...data.accounts);
      holdings.push(...data.holdings.map((holding) => {
        const instrument = getInstrumentOrFallback(holding.symbol);
        return {
          ...holding,
          sleeve: instrument.sleeve,
          // The verified broker cost basis is the initial principal watermark
          // for tactical products unless the investor later sets a fixed one.
          tacticalCostBasisTotal:
            instrument.leverage > 1
              ? (holding.tacticalCostBasisTotal ?? holding.costBasisTotal)
              : holding.tacticalCostBasisTotal,
          verification: 'CONFIRMED' as const,
        };
      }));
      liveBrokers.add(adapter.id);
      notes.push(`${adapter.label} accounts, cash and positions are sourced live from the connected brokerage.`);
    } catch (error) {
      console.warn(`[dahcorp] ${adapter.label} live portfolio convergence failed:`, error instanceof Error ? error.message : 'unknown error');
      notes.push(`${adapter.label} live portfolio state was unavailable; the prior stored source was retained for that lane.`);
    }
  }

  if (!liveBrokers.size) return source;

  // Once real brokerage data exists, remove any remaining seed broker fixtures
  // that were not replaced. A missing broker is safer as missing than synthetic.
  if (source.origin === 'seed') {
    const liveIds = new Set(accounts.filter((account) => account.dataQuality === 'live').map((account) => account.id));
    accounts = accounts.filter((account) => liveIds.has(account.id));
    holdings = holdings.filter((holding) => liveIds.has(holding.accountId));
  }

  const accountIds = new Set(accounts.map((account) => account.id));
  const contributions = source.origin === 'seed'
    ? []
    : source.contributions.filter((contribution) => accountIds.has(contribution.accountId));
  const incomeEvents = source.origin === 'seed'
    ? null
    : source.incomeEvents?.filter((event) => accountIds.has(event.accountId)) ?? null;

  return {
    origin: 'broker',
    accounts,
    holdings,
    incomeEvents,
    contributions,
    // Seed corporate actions are synthetic test fixtures and must never alter
    // production broker history. Persisted investor-entered actions are kept.
    corporateActions: source.origin === 'seed' ? [] : source.corporateActions,
    notes: [...new Set(notes.filter((note) => !note.startsWith('Positions are seeded MOCK fixtures')))],
    containsMockData: accounts.some((account) => account.dataQuality === 'mock'),
  };
}

/**
 * Brokerage visibility is not spending authority.
 *
 * Robinhood MCP already restricts allocation to the Agentic account. Schwab's
 * Trader API can expose several taxable accounts, but the Income mandate should
 * not silently absorb cash from unrelated accounts. Until an explicit account
 * mandate setting exists, only the Schwab account that actually holds YMAG is
 * allocation-authorized for the Income Engine. Every other Schwab account stays
 * visible on the household balance sheet but contributes $0 to investable cash.
 */
export function applyAccountMandates(source: PositionSource): PositionSource {
  const schwabIncomeAccounts = new Set(
    source.holdings
      .filter((holding) => holding.symbol.toUpperCase() === 'YMAG')
      .map((holding) => holding.accountId),
  );

  const accounts = source.accounts.map((account) => {
    if (account.broker !== 'schwab') return account;
    const authorized = schwabIncomeAccounts.has(account.id) && account.type === 'taxable';
    return {
      ...account,
      allocationEligible: authorized,
      tradeEligible: authorized && account.tradeEligible,
      role: authorized
        ? 'Schwab Income Engine account — cash may be considered by the income strategy.'
        : 'Schwab account visible for household awareness; cash is not authorized for automated allocation.',
    };
  });

  return {
    ...source,
    accounts,
    notes: [
      ...source.notes,
      'Cash authority is mandate-specific: Robinhood Agentic funds Growth; only the designated Schwab Income account contributes to Income deployable cash. Other broker cash remains visible but unavailable to the agent.',
    ],
  };
}

/**
 * Prefer Schwab Market Data Production when the connected Schwab adapter is
 * available. It supplies live quotes for the whole watched universe and live
 * daily history for the strategy allowlist. Distribution history remains the
 * explicitly-labelled synthetic fallback for now.
 */
export function selectMarketProvider(
  adapters: BrokerAdapter[],
  config: StrategyConfig,
  env: NodeJS.ProcessEnv = process.env,
): MarketDataProvider {
  const schwab = adapters.find(
    (adapter): adapter is SchwabAdapter => adapter.id === 'schwab' && adapter.isConfigured() && adapter.capabilities.includes('read_quotes'),
  );
  if (!schwab) return mockMarketDataProvider;

  const historySymbols = [
    ...new Set([
      ...config.agenticGrowthAllowlist,
      config.trend.benchmarkSymbol,
      'YMAG',
    ].map((symbol) => symbol.toUpperCase())),
  ];
  return new SchwabHybridMarketDataProvider(schwab, env, historySymbols);
}

export async function buildServerContext(options: { asOf?: string } = {}): Promise<ServerContext> {
  const asOf = options.asOf ?? todayISO();
  const [{ config, persisted, note }, storedSource, robinhoodGateway] = await Promise.all([
    loadStrategyConfig(),
    loadPositionSource(asOf),
    createRobinhoodGateway().catch(() => null),
  ]);

  const fallback = (broker: 'robinhood' | 'schwab') => fallbackFromSource(storedSource, broker);
  const adapters = buildBrokerRegistry(process.env as Record<string, string | undefined>, fallback, {
    robinhoodGateway,
    schwabTokenStore: {
      loadRefreshToken: loadSchwabRefreshToken,
      saveRefreshToken: saveSchwabRefreshToken,
    },
  });

  const converged = await convergeLiveBrokerState(storedSource, adapters);
  const source = applyAccountMandates(converged);
  const provider = selectMarketProvider(adapters, config);
  const snapshot = await buildPortfolioSnapshot({ asOf, provider, source });
  const analysisContext = buildAnalysisContext(snapshot, config);

  return {
    ...analysisContext,
    configPersisted: persisted,
    configNote: note,
    provider,
    brokers: describeBrokers(adapters, process.env as Record<string, string | undefined>),
    adapters,
  };
}

/** Config-only context, for endpoints that do not need market data. */
export async function loadConfigOnly(): Promise<{ config: StrategyConfig; persisted: boolean; note: string | null }> {
  const { config, persisted, note } = await loadStrategyConfig();
  return { config, persisted, note };
}

export { seedPositionSource };
