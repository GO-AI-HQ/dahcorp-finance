import type { Account, Holding, PortfolioSnapshot, Quote, Sleeve } from './types.js';
import type { StrategyConfig } from './config.js';
import { safeDiv, sum } from './math.js';
import { getInstrumentOrFallback, SLEEVE_ORDER } from './universe.js';

export interface PositionView {
  holding: Holding;
  account: Account;
  symbol: string
  name: string;
  sleeve: Sleeve;
  leverage: number;
  exposure: string;
  sector: string;
  shares: number;
  price: number;
  marketValue: number;
  costBasisTotal: number;
  costBasisPerShare: number | null;
  unrealizedPL: number;
  unrealizedPLPct: number | null;
  dayChangePct: number;
  /** Share of total portfolio value. */
  weight: number;
  legacy: boolean;
  /** Basis used for tactical harvest math — falls back to the real basis. */
  tacticalCostBasisTotal: number;
}

export interface SleeveAllocation {
  sleeve: Sleeve;
  marketValue: number;
  weight: number;
  positions: number;
  symbols: string[];
  /** Configured ceiling as a fraction, if any. */
  ceiling: number | null;
  overCeiling: boolean;
}

export interface ExposureConcentration {
  exposure: string;
  marketValue: number;
  weight: number;
  symbols: string[];
}

export interface PortfolioTotals {
  totalValue: number;
  totalCash: number;
  totalInvested: number;
  totalCostBasis: number;
  unrealizedPL: number;
  unrealizedPLPct: number | null;
  /** Cash the risk engine considers investable after the liquidity reserve. */
  investableCash: number;
  reservedCash: number;
}

export interface AccountRollup {
  account: Account;
  positionsValue: number;
  cash: number;
  totalValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPct: number | null;
  positionCount: number;
}

export interface PortfolioAnalysis {
  asOf: string;
  totals: PortfolioTotals;
  positions: PositionView[];
  accounts: AccountRollup[];
  sleeves: SleeveAllocation[];
  exposures: ExposureConcentration[];
  /** Total value in leveraged instruments and its share of the portfolio. */
  leveragedValue: number;
  leveragedPct: number;
  /** Capital currently deployed in the income engine. */
  incomeEngineCapital: number;
  incomeEnginePct: number;
  /** Positions exceeding the single-position ceiling. */
  concentrationBreaches: { symbol: string; weight: number; limit: number }[];
  containsMockData: boolean;
}

function quoteFor(quotes: Record<string, Quote>, symbol: string): Quote | undefined {
  return quotes[symbol.toUpperCase()];
}

export function buildPositionViews(snapshot: PortfolioSnapshot): PositionView[] {
  const accountsById = new Map(snapshot.accounts.map((a) => [a.id, a]));
  const rawTotal = sum(
    snapshot.holdings.map((h) => h.shares * (quoteFor(snapshot.quotes, h.symbol)?.price ?? 0)),
  );
  const totalWithCash = rawTotal + sum(snapshot.accounts.map((a) => a.cash));

  return snapshot.holdings
    .map((holding) => {
      const account = accountsById.get(holding.accountId);
      if (!account) return null;
      const instrument = getInstrumentOrFallback(holding.symbol);
      const quote = quoteFor(snapshot.quotes, holding.symbol);
      const price = quote?.price ?? 0;
      const marketValue = holding.shares * price;
      const unrealizedPL = marketValue - holding.costBasisTotal;
      const view: PositionView = {
        holding,
        account,
        symbol: holding.symbol.toUpperCase(),
        name: instrument.name,
        // A holding may override the instrument default (e.g. a legacy TSM
        // fraction parked outside the growth thesis).
        sleeve: holding.sleeve ?? instrument.sleeve,
        leverage: instrument.leverage,
        exposure: instrument.exposure,
        sector: instrument.sector,
        shares: holding.shares,
        price,
        marketValue,
        costBasisTotal: holding.costBasisTotal,
        costBasisPerShare: holding.shares > 0 ? holding.costBasisTotal / holding.shares : null,
        unrealizedPL,
        unrealizedPLPct: holding.costBasisTotal > 0 ? unrealizedPL / holding.costBasisTotal : null,
        dayChangePct: quote?.dayChangePct ?? 0,
        weight: safeDiv(marketValue, totalWithCash),
        legacy: holding.legacy ?? false,
        tacticalCostBasisTotal: holding.tacticalCostBasisTotal ?? holding.costBasisTotal,
      };
      return view;
    })
    .filter((p): p is PositionView => p !== null)
    .sort((a, b) => b.marketValue - a.marketValue);
}

export function analyzePortfolio(snapshot: PortfolioSnapshot, config: StrategyConfig): PortfolioAnalysis {
  const positions = buildPositionViews(snapshot);
  const totalCash = sum(snapshot.accounts.map((a) => a.cash));
  const totalInvested = sum(positions.map((p) => p.marketValue));
  const totalValue = totalInvested + totalCash;
  const totalCostBasis = sum(positions.map((p) => p.costBasisTotal));
  const unrealizedPL = totalInvested - totalCostBasis;

  const reservedCash = Math.min(totalCash, Math.max(0, config.liquidityReserve));
  const totals: PortfolioTotals = {
    totalValue,
    totalCash,
    totalInvested,
    totalCostBasis,
    unrealizedPL,
    unrealizedPLPct: totalCostBasis > 0 ? unrealizedPL / totalCostBasis : null,
    reservedCash,
    investableCash: Math.max(0, totalCash - reservedCash),
  };

  const accounts: AccountRollup[] = snapshot.accounts.map((account) => {
    const own = positions.filter((p) => p.holding.accountId === account.id);
    const positionsValue = sum(own.map((p) => p.marketValue));
    const costBasis = sum(own.map((p) => p.costBasisTotal));
    const pl = positionsValue - costBasis;
    return {
      account,
      positionsValue,
      cash: account.cash,
      totalValue: positionsValue + account.cash,
      costBasis,
      unrealizedPL: pl,
      unrealizedPLPct: costBasis > 0 ? pl / costBasis : null,
      positionCount: own.length,
    };
  });

  const sleeveMap = new Map<Sleeve, PositionView[]>();
  for (const p of positions) {
    const list = sleeveMap.get(p.sleeve) ?? [];
    list.push(p);
    sleeveMap.set(p.sleeve, list);
  }
  const sleeves: SleeveAllocation[] = SLEEVE_ORDER.filter(
    (s) => sleeveMap.has(s) || s === 'cash',
  ).map((sleeve) => {
    const list = sleeveMap.get(sleeve) ?? [];
    const marketValue = sleeve === 'cash' ? totalCash : sum(list.map((p) => p.marketValue));
    const weight = safeDiv(marketValue, totalValue);
    const ceiling = config.sleeveCeilings[sleeve] ?? null;
    return {
      sleeve,
      marketValue,
      weight,
      positions: sleeve === 'cash' ? snapshot.accounts.length : list.length,
      symbols: list.map((p) => p.symbol),
      ceiling,
      overCeiling: ceiling != null && weight > ceiling,
    };
  });

  const exposureMap = new Map<string, PositionView[]>();
  for (const p of positions) {
    const list = exposureMap.get(p.exposure) ?? [];
    list.push(p);
    exposureMap.set(p.exposure, list);
  }
  const exposures: ExposureConcentration[] = [...exposureMap.entries()]
    .map(([exposure, list]) => {
      const marketValue = sum(list.map((p) => p.marketValue));
      return { exposure, marketValue, weight: safeDiv(marketValue, totalValue), symbols: list.map((p) => p.symbol) };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  const leveragedValue = sum(positions.filter((p) => p.leverage > 1).map((p) => p.marketValue));
  const incomeEngineCapital = sum(positions.filter((p) => p.sleeve === 'income_engine').map((p) => p.marketValue));

  const concentrationBreaches = positions
    .filter((p) => p.weight > config.maxSinglePositionPct)
    .map((p) => ({ symbol: p.symbol, weight: p.weight, limit: config.maxSinglePositionPct }));

  return {
    asOf: snapshot.asOf,
    totals,
    positions,
    accounts,
    sleeves,
    exposures,
    leveragedValue,
    leveragedPct: safeDiv(leveragedValue, totalValue),
    incomeEngineCapital,
    incomeEnginePct: safeDiv(incomeEngineCapital, totalValue),
    concentrationBreaches,
    containsMockData: snapshot.containsMockData,
  };
}

/** Portfolio-value share by underlying exposure — feeds the overlap penalty. */
export function exposureWeights(analysis: PortfolioAnalysis): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of analysis.exposures) out[e.exposure] = e.weight;
  return out;
}
