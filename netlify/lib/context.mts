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
import {
  ENERGY_INTELLIGENCE_SYMBOLS,
  SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
  SHIPPING_INTELLIGENCE_SYMBOLS,
  TECHNOLOGY_INTELLIGENCE_SYMBOLS,
} from '../../src/intelligence/taxonomy.js';
import { loadPositionSource, loadStrategyConfig } from './store.mts';
import type { StrategyConfig } from '../../src/core/config.js';
import { loadSchwabRefreshToken, saveSchwabRefreshToken } from './schwabTokens.mts';
import { createRobinhoodGateway } from './robinhoodMcp.mts';
import { SchwabHybridMarketDataProvider } from './schwabMarketProvider.mts';
import { OpenBBGatewayMarketDataProvider, SchwabOpenBBMarketDataProvider } from './openbbGatewayProvider.mts';
import { resolveOpenBBSigningKeyValue } from './openbbGatewayClient.mts';
import { FmpPreferredMarketDataProvider } from './fmpDistributionProvider.mts';
import { StableDistributionMarketDataProvider } from './stableDistributionEvidence.mts';
import type { SchwabAdapter } from '../../src/brokers/schwab/adapter.js';

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface ServerContext extends AnalysisContext {
  configPersisted: boolean;
  configNote: string | null;
  provider: MarketDataProvider;
  brokers: BrokerStatus[];
  adapters: BrokerAdapter[];
}

function runtimeEnv(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env[key] != null) return env[key];
  try {
    const netlify = (globalThis as typeof globalThis & { Netlify?: { env?: { get?: (name: string) => string | undefined } } }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

function productionDataOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return runtimeEnv('DAHCORP_PRODUCTION_DATA_ONLY', env)?.trim().toLowerCase() === 'true';
}

function fallbackFromSource(source: PositionSource, broker: 'robinhood' | 'schwab'): BrokerAccountData {
  const ids = new Set(source.accounts.filter((account) => account.broker === broker).map((account) => account.id));
  return {
    accounts: source.accounts.filter((account) => account.broker === broker),
    holdings: source.holdings.filter((holding) => ids.has(holding.accountId)),
    incomeEvents: source.incomeEvents?.filter((event) => ids.has(event.accountId)) ?? undefined,
    asOf: new Date().toISOString(),
  };
}

function unknownProductionSource(notes: string[]): PositionSource {
  return {
    origin: 'broker',
    accounts: [],
    holdings: [],
    incomeEvents: [],
    contributions: [],
    corporateActions: [],
    notes: [...new Set([
      ...notes.filter((note) => !/seed|mock|fixture/i.test(note)),
      'Production-data-only mode is active. Live brokerage state was unavailable, so seeded balances and positions were suppressed rather than substituted.',
    ])],
    containsMockData: false,
  };
}

async function convergeLiveBrokerState(source: PositionSource, adapters: BrokerAdapter[], strictProduction = false): Promise<PositionSource> {
  let accounts = source.origin === 'seed' ? source.accounts.filter((account) => account.broker !== 'manual') : [...source.accounts];
  let holdings = source.origin === 'seed'
    ? source.holdings.filter((holding) => accounts.some((account) => account.id === holding.accountId))
    : [...source.holdings];
  let incomeEvents = source.origin === 'seed' ? [] : [...(source.incomeEvents ?? [])];
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
        notes.push(`${adapter.label} authenticated but returned no accounts; no live state was promoted for that lane.`);
        continue;
      }

      const oldIds = new Set(accounts.filter((account) => account.broker === adapter.id).map((account) => account.id));
      const newIds = new Set(data.accounts.map((account) => account.id));
      accounts = accounts.filter((account) => account.broker !== adapter.id);
      holdings = holdings.filter((holding) => !oldIds.has(holding.accountId));
      accounts.push(...data.accounts);
      holdings.push(...data.holdings.map((holding) => {
        const instrument = getInstrumentOrFallback(holding.symbol);
        const costBasisKnown = holding.costBasisKnown ?? holding.costBasisTotal > 0;
        return {
          ...holding,
          sleeve: instrument.sleeve,
          costBasisKnown,
          tacticalCostBasisTotal:
            instrument.leverage > 1 && costBasisKnown
              ? (holding.tacticalCostBasisTotal ?? holding.costBasisTotal)
              : holding.tacticalCostBasisTotal,
          verification: 'CONFIRMED' as const,
        };
      }));

      // Existing adapters may not expose transaction history yet. When an
      // adapter does supply brokerage-observed income events, replace only that
      // broker's prior realized-income rows and preserve all other brokers.
      if (data.incomeEvents) {
        incomeEvents = incomeEvents.filter((event) => !oldIds.has(event.accountId));
        incomeEvents.push(...data.incomeEvents.filter((event) => newIds.has(event.accountId)));
        notes.push(`${adapter.label} realized income events are sourced from the connected brokerage when provided by the adapter.`);
      }

      liveBrokers.add(adapter.id);
      notes.push(`${adapter.label} accounts, cash and positions are sourced live from the connected brokerage.`);
    } catch (error) {
      console.warn(`[dahcorp] ${adapter.label} live portfolio convergence failed:`, error instanceof Error ? error.message : 'unknown error');
      notes.push(`${adapter.label} live portfolio state was unavailable.`);
    }
  }

  if (!liveBrokers.size) {
    if (strictProduction) return unknownProductionSource(notes);
    return source;
  }

  if (source.origin === 'seed' || strictProduction) {
    const liveIds = new Set(accounts.filter((account) => account.dataQuality === 'live').map((account) => account.id));
    accounts = accounts.filter((account) => liveIds.has(account.id));
    holdings = holdings.filter((holding) => liveIds.has(holding.accountId));
  }

  const accountIds = new Set(accounts.map((account) => account.id));
  const contributions = source.origin === 'seed' || strictProduction
    ? source.contributions.filter((contribution) => accountIds.has(contribution.accountId) && source.origin !== 'seed')
    : source.contributions.filter((contribution) => accountIds.has(contribution.accountId));
  incomeEvents = incomeEvents.filter((event) => accountIds.has(event.accountId));

  return {
    origin: 'broker',
    accounts,
    holdings,
    incomeEvents,
    contributions,
    corporateActions: source.origin === 'seed' ? [] : source.corporateActions,
    notes: [...new Set(notes.filter((note) => !/seeded MOCK fixtures|fixture fallback/i.test(note)))],
    containsMockData: false,
  };
}

/** Brokerage visibility is not spending authority. */
export function applyAccountMandates(source: PositionSource): PositionSource {
  const ymAccounts = new Set(source.holdings.filter((holding) => holding.symbol.toUpperCase() === 'YMAG').map((holding) => holding.accountId));
  const shippingAccounts = new Set(
    source.holdings
      .filter((holding) => getInstrumentOrFallback(holding.symbol).sleeve === 'shipping_cyclical')
      .map((holding) => holding.accountId),
  );

  const accounts = source.accounts.map((account) => {
    if (account.broker !== 'schwab') return account;
    const incomeAuthorized = account.type === 'taxable' && (account.name.includes('3085') || ymAccounts.has(account.id));
    const shippingAuthorized = !incomeAuthorized && shippingAccounts.has(account.id);
    if (incomeAuthorized) {
      return {
        ...account,
        allocationEligible: true,
        tradeEligible: account.tradeEligible,
        role: 'Schwab Income account (3085) — cash is reserved for YMAG and qualified income rotations.',
      };
    }
    if (shippingAuthorized) {
      return {
        ...account,
        allocationEligible: true,
        tradeEligible: account.tradeEligible,
        role: 'Schwab Maritime account — cash is reserved for the Shipping accumulation strategy.',
      };
    }
    return {
      ...account,
      allocationEligible: false,
      tradeEligible: false,
      role: 'Schwab account visible for household awareness; cash is not authorized for a DAHCorp strategy mandate.',
    };
  });

  return {
    ...source,
    accounts,
    notes: [
      ...source.notes,
      'Cash authority is mandate-specific: Robinhood Agentic funds Growth; Schwab 3085 funds Income; a Schwab account with confirmed maritime holdings funds Shipping. Other broker cash remains visible but unavailable to the agent.',
    ],
  };
}

function unavailableProductionMarketProvider(): MarketDataProvider {
  return {
    id: 'production-market-unavailable',
    isMock: false,
    sourceNotes: ['No production market-data provider is currently reachable. Market values remain UNKNOWN; no synthetic fallback is permitted.'],
    async getQuotes() { return {}; },
    async getPriceHistory() { return {}; },
    async getDistributions() { return []; },
  };
}

export function selectMarketProvider(
  adapters: BrokerAdapter[],
  config: StrategyConfig,
  env: NodeJS.ProcessEnv = process.env,
): MarketDataProvider {
  const strictProduction = productionDataOnly(env);
  const schwab = adapters.find(
    (adapter): adapter is SchwabAdapter => adapter.id === 'schwab' && adapter.isConfigured() && adapter.capabilities.includes('read_quotes'),
  );
  const openbbEnv: NodeJS.ProcessEnv = {
    ...env,
    OPENBB_GATEWAY_URL: runtimeEnv('OPENBB_GATEWAY_URL', env),
    OPENBB_GATEWAY_SIGNING_KEY: resolveOpenBBSigningKeyValue(env),
    OPENBB_MARKET_PROVIDER: runtimeEnv('OPENBB_MARKET_PROVIDER', env),
  };
  const openbb = new OpenBBGatewayMarketDataProvider(openbbEnv);

  const historySymbols = [
    ...new Set([
      ...config.agenticGrowthAllowlist,
      config.trend.benchmarkSymbol,
      'YMAG', 'YMAX', 'NVDY',
      ...SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
      ...ENERGY_INTELLIGENCE_SYMBOLS,
      ...SHIPPING_INTELLIGENCE_SYMBOLS,
      ...TECHNOLOGY_INTELLIGENCE_SYMBOLS,
    ].map((symbol) => symbol.toUpperCase())),
  ];

  let base: MarketDataProvider;
  if (openbb.isConfigured()) {
    base = schwab
      ? new SchwabOpenBBMarketDataProvider(schwab, openbb, openbbEnv, historySymbols)
      : openbb;
  } else if (schwab) {
    base = new SchwabHybridMarketDataProvider(schwab, env, historySymbols, fetch, !strictProduction);
  } else {
    base = strictProduction ? unavailableProductionMarketProvider() : mockMarketDataProvider;
  }

  const fmpApiKey = runtimeEnv('FMP_API_KEY', env)?.trim();
  return fmpApiKey
    ? new FmpPreferredMarketDataProvider(base, { ...env, FMP_API_KEY: fmpApiKey })
    : base;
}

export async function buildServerContext(options: { asOf?: string } = {}): Promise<ServerContext> {
  const asOf = options.asOf ?? todayISO();
  const strictProduction = productionDataOnly();
  const [{ config, persisted, note }, storedSource, robinhoodGateway] = await Promise.all([
    loadStrategyConfig(),
    loadPositionSource(asOf),
    createRobinhoodGateway().catch(() => null),
  ]);

  const fallback = (broker: 'robinhood' | 'schwab') => fallbackFromSource(storedSource, broker);
  const adapters = buildBrokerRegistry(process.env as Record<string, string | undefined>, fallback, {
    robinhoodGateway,
    schwabTokenStore: { loadRefreshToken: loadSchwabRefreshToken, saveRefreshToken: saveSchwabRefreshToken },
  });

  const converged = await convergeLiveBrokerState(storedSource, adapters, strictProduction);
  const mandated = applyAccountMandates(converged);
  const source: PositionSource = config.externalLiquidityCurrent === 0
    ? { ...mandated, notes: [...mandated.notes, 'External household liquidity has not been confirmed; reserve status is shown as not entered rather than $0 underfunded.'] }
    : mandated;

  const selectedProvider = selectMarketProvider(adapters, config);
  const provider = new StableDistributionMarketDataProvider(selectedProvider, source.incomeEvents ?? []);
  const snapshot = await buildPortfolioSnapshot({ asOf, provider, source });
  const analysisContext = buildAnalysisContext(snapshot, config);

  if (config.externalLiquidityCurrent === 0) {
    analysisContext.analysis.totals.externalLiquidityGap = 0;
    analysisContext.analysis.totals.externalReserveUnderfunded = false;
  }

  return {
    ...analysisContext,
    configPersisted: persisted,
    configNote: note,
    provider,
    brokers: describeBrokers(adapters, process.env as Record<string, string | undefined>),
    adapters,
  };
}

export async function loadConfigOnly(): Promise<{ config: StrategyConfig; persisted: boolean; note: string | null }> {
  const { config, persisted, note } = await loadStrategyConfig();
  return { config, persisted, note };
}

export { seedPositionSource };
