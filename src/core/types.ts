/**
 * DAHCorp Finance — core domain types.
 *
 * Everything in `src/core` is pure, deterministic and side-effect free so the
 * same code runs in the browser, in Netlify Functions and in tests. No prices,
 * distributions or yields are ever hard-coded here — values always arrive as
 * arguments.
 */

/** Where a holding sits in the four-engine strategy. */
export type Sleeve =
  | 'income_engine'
  | 'core_growth'
  | 'shipping_cyclical'
  | 'reit_dividend'
  | 'tactical_leveraged'
  | 'cash'
  | 'future_education'
  | 'unclassified';

export type BrokerId = 'robinhood' | 'schwab' | 'manual';

export type AccountType = 'taxable' | 'roth_ira' | 'education' | 'other';

/** How much confidence to place in the numbers being shown. */
export type DataQuality = 'live' | 'delayed' | 'mock' | 'stale';

export interface Account {
  id: string;
  broker: BrokerId;
  /** Human label, e.g. "Robinhood — Active Accumulation". */
  name: string;
  type: AccountType;
  /** Strategic role in the plan; shown in the UI. */
  role: string;
  cash: number;
  /** Phase 1: only taxable accounts are eligible for new allocation. */
  allocationEligible: boolean;
  /** Phase 1: no account is trade-eligible. */
  tradeEligible: boolean;
  dataQuality: DataQuality;
}

export interface Holding {
  id: string;
  accountId: string;
  symbol: string;
  /** Fractional shares are normal here (Robinhood dollar-based buys). */
  shares: number;
  /** Total dollars paid, not per-share. */
  costBasisTotal: number;
  /** Tactical cost basis for leveraged sleeve harvest math, when it differs. */
  tacticalCostBasisTotal?: number;
  sleeve: Sleeve;
  /** Set when the position is a legacy remnant rather than an active thesis. */
  legacy?: boolean;
  openedAt?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  dayChangePct: number;
  bid?: number;
  ask?: number;
  /** Average daily share volume, used for liquidity scoring. */
  avgVolume?: number;
  high52w?: number;
  low52w?: number;
  asOf: string;
  dataQuality: DataQuality;
}

/** One historical daily close. Oldest first. */
export interface PriceBar {
  date: string;
  close: number;
}

export type DistributionKind = 'distribution' | 'dividend' | 'return_of_capital' | 'special';

/**
 * A single declared distribution. `amountPerShare` is the gross cash paid per
 * share; `returnOfCapitalPct` (0-1) is the portion classified as ROC by the
 * fund. ROC is a return of the investor's own money, not profit.
 */
export interface DistributionEvent {
  symbol: string;
  exDate: string;
  payDate: string;
  amountPerShare: number;
  kind: DistributionKind;
  returnOfCapitalPct?: number;
  frequency: DistributionFrequency;
  dataQuality: DataQuality;
}

export type DistributionFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'irregular';

/** Cash actually received into an account (the audited, not modeled, number). */
export interface IncomeEvent {
  id: string;
  accountId: string;
  symbol: string;
  payDate: string;
  grossAmount: number;
  sharesAtRecord: number;
  reinvested: boolean;
}

export interface Contribution {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  note?: string;
}

/** Split / reverse-split / ticker change / merger record. */
export interface CorporateAction {
  symbol: string;
  effectiveDate: string;
  type: 'split' | 'reverse_split' | 'ticker_change' | 'merger' | 'delisting' | 'cash_in_lieu';
  /** For splits: new shares per old share (2 = 2-for-1, 0.1 = 1-for-10 reverse). */
  ratio?: number;
  newSymbol?: string;
  cashPerShare?: number;
}

/** Complete, self-consistent snapshot the whole app renders from. */
export interface PortfolioSnapshot {
  asOf: string;
  dataQuality: DataQuality;
  /** True when any part of the snapshot is synthetic fixture data. */
  containsMockData: boolean;
  sourceNotes: string[];
  accounts: Account[];
  holdings: Holding[];
  quotes: Record<string, Quote>;
  distributions: DistributionEvent[];
  incomeEvents: IncomeEvent[];
  contributions: Contribution[];
  priceHistory: Record<string, PriceBar[]>;
  corporateActions: CorporateAction[];
}

/** Instrument metadata — drives sleeve defaults, leverage flags and universes. */
export interface InstrumentMeta {
  symbol: string;
  name: string;
  assetClass: 'etf' | 'etp' | 'equity' | 'reit' | 'fund';
  sleeve: Sleeve;
  /** Daily-reset leverage multiple. 1 for unlevered. */
  leverage: number;
  distributionFrequency: DistributionFrequency;
  /** Broad sector for concentration and correlation grouping. */
  sector: string;
  /** Underlying exposure key — used to detect portfolio overlap. */
  exposure: string;
  notes?: string;
}
