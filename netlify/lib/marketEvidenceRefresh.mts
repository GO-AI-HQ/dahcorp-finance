import type { BrokerAccountData } from '../../src/brokers/types.js';
import { buildBrokerRegistry } from '../../src/brokers/registry.js';
import { distributionSymbols, HISTORY_DAYS, snapshotSymbols, type PositionSource } from '../../src/services/snapshot.js';
import { loadPositionSource, loadStrategyConfig } from './store.mts';
import { applyAccountMandates, selectMarketProvider, todayISO } from './context.mts';
import { loadSchwabRefreshToken, saveSchwabRefreshToken } from './schwabTokens.mts';
import { getFmpDistributions } from './fmpDistributionProvider.mts';
import { saveMarketEvidence } from './marketEvidenceStore.mts';
import { rebuildPreparedMarketSnapshot } from './preparedMarketSnapshot.mts';

function fallbackFromSource(source: PositionSource, broker: 'robinhood' | 'schwab'): BrokerAccountData {
  const ids = new Set(source.accounts.filter((account) => account.broker === broker).map((account) => account.id));
  return {
    accounts: source.accounts.filter((account) => account.broker === broker),
    holdings: source.holdings.filter((holding) => ids.has(holding.accountId)),
    incomeEvents: source.incomeEvents?.filter((event) => ids.has(event.accountId)) ?? undefined,
    asOf: new Date().toISOString(),
  };
}

async function buildMarketRefreshBasis(asOf = todayISO()) {
  const [{ config }, storedSource] = await Promise.all([
    loadStrategyConfig(),
    loadPositionSource(asOf),
  ]);
  const fallback = (broker: 'robinhood' | 'schwab') => fallbackFromSource(storedSource, broker);
  // Market refreshes need quote-capable adapter construction but deliberately do
  // not authenticate/read broker account state. Holdings/cash refresh remains a
  // separate Portfolio Snapshot concern.
  const adapters = buildBrokerRegistry(process.env as Record<string, string | undefined>, fallback, {
    robinhoodGateway: null,
    schwabTokenStore: { loadRefreshToken: loadSchwabRefreshToken, saveRefreshToken: saveSchwabRefreshToken },
  });
  const source = applyAccountMandates(storedSource);
  const provider = selectMarketProvider(adapters, config);
  return { asOf, source, provider };
}

export async function refreshQuoteEvidence(): Promise<{
  requested: number;
  stored: number;
  marketSnapshotPersisted: boolean;
}> {
  const { asOf, source, provider } = await buildMarketRefreshBasis();
  const symbols = snapshotSymbols(source.holdings);
  const quotes = await provider.getQuotes(symbols, asOf);
  const observedAt = new Date().toISOString();
  const writes = await Promise.all(Object.entries(quotes).map(([symbol, quote]) => saveMarketEvidence({
    kind: 'quote',
    symbol,
    observedAt,
    providerId: provider.id,
    containsMockData: provider.isMock || quote.dataQuality === 'mock',
    payload: quote,
  })));
  const market = await rebuildPreparedMarketSnapshot(source.holdings);
  return { requested: symbols.length, stored: writes.filter(Boolean).length, marketSnapshotPersisted: market.persisted };
}

export async function refreshHistoryEvidence(): Promise<{
  requested: number;
  stored: number;
  marketSnapshotPersisted: boolean;
}> {
  const { asOf, source, provider } = await buildMarketRefreshBasis();
  const symbols = snapshotSymbols(source.holdings);
  const history = await provider.getPriceHistory(symbols, asOf, HISTORY_DAYS);
  const observedAt = new Date().toISOString();
  const writes = await Promise.all(Object.entries(history)
    .filter(([, bars]) => bars.length > 0)
    .map(([symbol, bars]) => saveMarketEvidence({
      kind: 'history',
      symbol,
      observedAt,
      providerId: provider.id,
      containsMockData: provider.isMock,
      payload: bars,
    })));
  const market = await rebuildPreparedMarketSnapshot(source.holdings);
  return { requested: symbols.length, stored: writes.filter(Boolean).length, marketSnapshotPersisted: market.persisted };
}

export async function refreshDistributionEvidence(): Promise<{
  requested: number;
  stored: number;
  fmpCallsUsed: number;
  marketSnapshotPersisted: boolean;
}> {
  const { asOf, source, provider } = await buildMarketRefreshBasis();
  const symbols = distributionSymbols(source.holdings);

  // This is the scheduled network-owning path for FMP. Warming its persistent
  // cache first allows the normal composite provider to use FMP where verified
  // and OpenBB only for symbols that still need fallback evidence.
  const fmp = await getFmpDistributions(symbols, asOf, HISTORY_DAYS, { allowNetwork: true });
  const events = await provider.getDistributions(symbols, asOf, HISTORY_DAYS);
  const bySymbol = new Map<string, typeof events>();
  for (const event of events) {
    const symbol = event.symbol.toUpperCase();
    const rows = bySymbol.get(symbol) ?? [];
    rows.push(event);
    bySymbol.set(symbol, rows);
  }

  const observedAt = new Date().toISOString();
  const writes = await Promise.all([...bySymbol].map(([symbol, rows]) => saveMarketEvidence({
    kind: 'distribution',
    symbol,
    observedAt,
    providerId: provider.id,
    containsMockData: provider.isMock || rows.some((row) => row.dataQuality === 'mock'),
    payload: rows.sort((a, b) => a.exDate.localeCompare(b.exDate)),
  })));
  const market = await rebuildPreparedMarketSnapshot(source.holdings);
  return {
    requested: symbols.length,
    stored: writes.filter(Boolean).length,
    fmpCallsUsed: fmp.callsUsed,
    marketSnapshotPersisted: market.persisted,
  };
}
