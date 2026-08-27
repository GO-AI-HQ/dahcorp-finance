import type { Account, AccountType, Holding, PortfolioSnapshot, Quote, Sleeve } from './types.js';
import type { StrategyConfig } from './config.js';
import { safeDiv, sum } from './math.js';
import { getInstrumentOrFallback, SLEEVE_ORDER } from './universe.js';
import type { CalculationScope, VerificationStatus } from './scope.js';
import {
  accountInScope,
  CALCULATION_SCOPES,
  CALCULATION_SCOPE_LABELS,
  isVerified,
  positionInScope,
  riskScopeFor,
  scopeExclusionReason,
  verificationOf,
} from './scope.js';

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
  /** Share of total portfolio value. Scope-relative weights live on ScopeView. */
  weight: number;
  legacy: boolean;
  accountType: AccountType;
  /** Whether ownership and cost basis are verified. Fixtures are SIMULATED. */
  verification: VerificationStatus;
  /** Convenience: `verification === 'CONFIRMED'`. Only these drive decisions. */
  verified: boolean;
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
  /** Cash held inside the brokerages, across every account in the snapshot. */
  brokerCash: number;
  /**
   * Brokerage cash the risk engine may deploy: cash in allocation-eligible
   * accounts, less the settlement floor. The household reserve is *not*
   * subtracted here — it lives outside the brokerages.
   */
  deployableBrokerCash: number;
  /** Broker cash withheld by the settlement floor. */
  brokerCashFloorHeld: number;
  /** Household reserve target, held outside the brokerages. */
  externalLiquidityTarget: number;
  /** Household reserve currently held, as entered by the investor. */
  externalLiquidityCurrent: number;
  /** Shortfall against the household reserve target; zero when funded. */
  externalLiquidityGap: number;
  externalReserveUnderfunded: boolean;
}

/** Per-position weight inside a scope, keyed by holding id. */
export type ScopeWeights = Record<string, number>;

/** A position deliberately left out of a scope, with the reason shown in UI. */
export interface ScopeExclusion {
  holdingId: string;
  symbol: string;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  sleeve: Sleeve;
  marketValue: number;
  reason: string;
}

/**
 * Every headline number, recomputed for one slice of capital.
 *
 * Scope views are derived, never authoritative: the snapshot still holds every
 * account, and switching scope only changes which positions and cash the
 * arithmetic runs over.
 */
export interface ScopeView {
  scope: CalculationScope;
  label: string;
  /** Accounts admitted by this scope. */
  accountIds: string[];
  positions: PositionView[];
  /** Position weights relative to this scope's total value, by holding id. */
  weights: ScopeWeights;
  excluded: ScopeExclusion[];
  investedValue: number;
  brokerCash: number;
  deployableBrokerCash: number;
  /** Invested value plus in-scope broker cash. */
  totalValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPct: number | null;
  incomeEngineCapital: number;
  incomeEnginePct: number;
  leveragedValue: number;
  leveragedPct: number;
  sleeves: SleeveAllocation[];
  exposures: ExposureConcentration[];
  /** Confirmed positions over the single-position ceiling. */
  concentrationBreaches: { symbol: string; weight: number; limit: number }[];
  /**
   * Simulated / unverified positions that *would* breach. Reported for
   * transparency; they never gate a recommendation.
   */
  simulatedConcentrationBreaches: { symbol: string; weight: number; limit: number }[];
  confirmedValue: number;
  simulatedValue: number;
  /** Confirmed position value plus in-scope broker cash — the risk denominator. */
  verifiedTotalValue: number;
  containsSimulated: boolean;
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
  /** The scope selected in config; `scoped` is its view. */
  scope: CalculationScope;
  scoped: ScopeView;
  scopes: Record<CalculationScope, ScopeView>;
  /**
   * Scope the headline concentration list is measured in — all taxable capital
   * unless a whole-portfolio rule has been configured.
   */
  concentrationScope: CalculationScope;
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
      const verification = verificationOf(holding);
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
        accountType: account.type,
        verification,
        verified: isVerified(verification),
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

  // Brokerage cash and the household reserve are different pools of money.
  // Only the settlement floor is withheld from brokerage cash; the household
  // reserve target lives outside the brokerages and never converts a planned
  // contribution into zero investable capital.
  const brokerCashFloor = Math.max(0, config.brokerCashFloor);
  const eligibleCash = sum(snapshot.accounts.filter((a) => a.allocationEligible).map((a) => a.cash));
  const brokerCashFloorHeld = Math.min(eligibleCash, brokerCashFloor);
  const externalLiquidityTarget = Math.max(0, config.externalLiquidityTarget);
  const externalLiquidityCurrent = Math.max(0, config.externalLiquidityCurrent);
  const externalLiquidityGap = Math.max(0, externalLiquidityTarget - externalLiquidityCurrent);
  const totals: PortfolioTotals = {
    totalValue,
    totalCash,
    totalInvested,
    totalCostBasis,
    unrealizedPL,
    unrealizedPLPct: totalCostBasis > 0 ? unrealizedPL / totalCostBasis : null,
    brokerCash: totalCash,
    deployableBrokerCash: Math.max(0, eligibleCash - brokerCashFloorHeld),
    brokerCashFloorHeld,
    externalLiquidityTarget,
    externalLiquidityCurrent,
    externalLiquidityGap,
    externalReserveUnderfunded: externalLiquidityGap > 0,
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

  const scopes = buildScopeViews(snapshot, positions, config);
  const scope = config.calculationScope;
  // Concentration is measured across all taxable capital by default. Measuring
  // it inside the income-engine sleeve alone would make the ceiling tighter
  // than the strategy: with two positions in the sleeve, every buy would
  // breach a 35% single-position limit.
  const concentrationScope = riskScopeFor('concentration', 'taxable', config.wholePortfolioRules);

  return {
    asOf: snapshot.asOf,
    totals,
    scope,
    scoped: scopes[scope],
    scopes,
    concentrationScope,
    positions,
    accounts,
    sleeves,
    exposures,
    leveragedValue,
    leveragedPct: safeDiv(leveragedValue, totalValue),
    incomeEngineCapital,
    incomeEnginePct: safeDiv(incomeEngineCapital, totalValue),
    concentrationBreaches: scopes[concentrationScope].concentrationBreaches,
    containsMockData: snapshot.containsMockData,
  };
}

function buildScopeViews(
  snapshot: PortfolioSnapshot,
  positions: PositionView[],
  config: StrategyConfig,
): Record<CalculationScope, ScopeView> {
  const out = {} as Record<CalculationScope, ScopeView>;
  for (const scope of CALCULATION_SCOPES) out[scope] = buildScopeView(snapshot, positions, config, scope);
  return out;
}

/** Recompute every headline figure over one slice of capital. */
export function buildScopeView(
  snapshot: PortfolioSnapshot,
  positions: PositionView[],
  config: StrategyConfig,
  scope: CalculationScope,
): ScopeView {
  const accountsInScope = snapshot.accounts.filter((a) => accountInScope(a, scope));
  const inScope = positions.filter((p) => positionInScope(p, scope));
  const excluded: ScopeExclusion[] = positions
    .filter((p) => !positionInScope(p, scope))
    .map((p) => ({
      holdingId: p.holding.id,
      symbol: p.symbol,
      accountId: p.account.id,
      accountName: p.account.name,
      accountType: p.accountType,
      sleeve: p.sleeve,
      marketValue: p.marketValue,
      reason: scopeExclusionReason(p, scope) ?? '',
    }));

  const investedValue = sum(inScope.map((p) => p.marketValue));
  const brokerCash = sum(accountsInScope.map((a) => a.cash));
  const eligibleCash = sum(accountsInScope.filter((a) => a.allocationEligible).map((a) => a.cash));
  const deployableBrokerCash = Math.max(0, eligibleCash - Math.min(eligibleCash, Math.max(0, config.brokerCashFloor)));
  const totalValue = investedValue + brokerCash;
  const costBasis = sum(inScope.map((p) => p.costBasisTotal));
  const unrealizedPL = investedValue - costBasis;

  const weights: ScopeWeights = {};
  for (const p of inScope) weights[p.holding.id] = safeDiv(p.marketValue, totalValue);

  const sleeveMap = new Map<Sleeve, PositionView[]>();
  for (const p of inScope) {
    const list = sleeveMap.get(p.sleeve) ?? [];
    list.push(p);
    sleeveMap.set(p.sleeve, list);
  }
  const sleeves: SleeveAllocation[] = SLEEVE_ORDER.filter((s) => sleeveMap.has(s) || s === 'cash').map(
    (sleeve) => {
      const list = sleeveMap.get(sleeve) ?? [];
      const marketValue = sleeve === 'cash' ? brokerCash : sum(list.map((p) => p.marketValue));
      const weight = safeDiv(marketValue, totalValue);
      const ceiling = config.sleeveCeilings[sleeve] ?? null;
      return {
        sleeve,
        marketValue,
        weight,
        positions: sleeve === 'cash' ? accountsInScope.length : list.length,
        symbols: list.map((p) => p.symbol),
        ceiling,
        overCeiling: ceiling != null && weight > ceiling,
      };
    },
  );

  const exposureMap = new Map<string, PositionView[]>();
  for (const p of inScope) {
    const list = exposureMap.get(p.exposure) ?? [];
    list.push(p);
    exposureMap.set(p.exposure, list);
  }
  const exposures: ExposureConcentration[] = [...exposureMap.entries()]
    .map(([exposure, list]) => {
      const marketValue = sum(list.map((p) => p.marketValue));
      return {
        exposure,
        marketValue,
        weight: safeDiv(marketValue, totalValue),
        symbols: list.map((p) => p.symbol),
      };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  const leveragedValue = sum(inScope.filter((p) => p.leverage > 1).map((p) => p.marketValue));
  const incomeEngineCapital = sum(inScope.filter((p) => p.sleeve === 'income_engine').map((p) => p.marketValue));

  // Only confirmed holdings produce a real breach. A simulated fixture must be
  // able to demonstrate the calculation without gating a live recommendation.
  const breaching = inScope.filter((p) => weights[p.holding.id] > config.maxSinglePositionPct);
  const asBreach = (p: PositionView) => ({
    symbol: p.symbol,
    weight: weights[p.holding.id],
    limit: config.maxSinglePositionPct,
  });

  const confirmedValue = sum(inScope.filter((p) => p.verified).map((p) => p.marketValue));
  const simulatedValue = investedValue - confirmedValue;

  return {
    scope,
    label: CALCULATION_SCOPE_LABELS[scope],
    accountIds: accountsInScope.map((a) => a.id),
    positions: inScope,
    weights,
    excluded,
    investedValue,
    brokerCash,
    deployableBrokerCash,
    totalValue,
    costBasis,
    unrealizedPL,
    unrealizedPLPct: costBasis > 0 ? unrealizedPL / costBasis : null,
    incomeEngineCapital,
    incomeEnginePct: safeDiv(incomeEngineCapital, totalValue),
    leveragedValue,
    leveragedPct: safeDiv(leveragedValue, totalValue),
    sleeves,
    exposures,
    concentrationBreaches: breaching.filter((p) => p.verified).map(asBreach),
    simulatedConcentrationBreaches: breaching.filter((p) => !p.verified).map(asBreach),
    confirmedValue,
    simulatedValue,
    verifiedTotalValue: confirmedValue + brokerCash,
    containsSimulated: inScope.some((p) => !p.verified),
  };
}

/**
 * Value share by underlying exposure — feeds the overlap penalty.
 *
 * Pass a scope to measure within one slice of capital; omitted, it reports the
 * whole-portfolio weights.
 */
export function exposureWeights(
  analysis: PortfolioAnalysis,
  scope?: CalculationScope,
): Record<string, number> {
  const out: Record<string, number> = {};
  const exposures = scope ? analysis.scopes[scope].exposures : analysis.exposures;
  for (const e of exposures) out[e.exposure] = e.weight;
  return out;
}
