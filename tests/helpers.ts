/**
 * Test fixtures.
 *
 * Deliberately hand-built rather than generated: every price, share count and
 * distribution in a test is written out so the expected arithmetic can be
 * checked by hand. Nothing here is imported by the application.
 */
import type {
  Account,
  Contribution,
  CorporateAction,
  DistributionEvent,
  DistributionFrequency,
  Holding,
  IncomeEvent,
  PortfolioSnapshot,
  PriceBar,
  Quote,
} from '../src/core/types.js';
import { addDays } from '../src/core/dates.js';
import { getInstrumentOrFallback } from '../src/core/universe.js';

/** Fixed reference date. Every window calculation is measured against this. */
export const AS_OF = '2026-06-30';

/** Daily bars, oldest first, ending on `asOf`. */
export function barsEndingAt(closes: number[], asOf = AS_OF): PriceBar[] {
  const last = closes.length - 1;
  return closes.map((close, i) => ({ date: addDays(asOf, -(last - i)), close }));
}

export function flatBars(price: number, count = 220, asOf = AS_OF): PriceBar[] {
  return barsEndingAt(new Array(count).fill(price) as number[], asOf);
}

/** Straight line from `from` to `to` across `count` sessions. */
export function linearBars(from: number, to: number, count = 220, asOf = AS_OF): PriceBar[] {
  const step = count > 1 ? (to - from) / (count - 1) : 0;
  return barsEndingAt(
    Array.from({ length: count }, (_, i) => Number((from + step * i).toFixed(4))),
    asOf,
  );
}

export function makeQuote(symbol: string, price: number, extra: Partial<Quote> = {}): Quote {
  return {
    symbol: symbol.toUpperCase(),
    price,
    previousClose: price,
    dayChangePct: 0,
    asOf: AS_OF,
    dataQuality: 'mock',
    ...extra,
  };
}

/**
 * A payment history. `amounts` is oldest-first; the newest payment lands one day
 * before `asOf` and each earlier one steps back by `intervalDays`.
 */
export function payments(
  symbol: string,
  amounts: number[],
  opts: {
    asOf?: string;
    intervalDays?: number;
    frequency?: DistributionFrequency;
    returnOfCapitalPct?: number;
  } = {},
): DistributionEvent[] {
  const asOf = opts.asOf ?? AS_OF;
  const intervalDays = opts.intervalDays ?? 7;
  const frequency = opts.frequency ?? 'weekly';
  const last = amounts.length - 1;
  return amounts.map((amountPerShare, i) => {
    const payDate = addDays(asOf, -1 - (last - i) * intervalDays);
    return {
      symbol: symbol.toUpperCase(),
      exDate: addDays(payDate, -2),
      payDate,
      amountPerShare,
      kind: 'distribution' as const,
      returnOfCapitalPct: opts.returnOfCapitalPct,
      frequency,
      dataQuality: 'mock' as const,
    };
  });
}

/** `count` identical weekly payments of `amount`. */
export function steadyWeekly(
  symbol: string,
  amount: number,
  count = 52,
  opts: { asOf?: string; returnOfCapitalPct?: number } = {},
): DistributionEvent[] {
  return payments(symbol, new Array(count).fill(amount) as number[], {
    ...opts,
    intervalDays: 7,
    frequency: 'weekly',
  });
}

export function makeAccount(id: string, over: Partial<Account> = {}): Account {
  return {
    id,
    broker: 'schwab',
    name: `Account ${id}`,
    type: 'taxable',
    role: 'Test account.',
    cash: 0,
    allocationEligible: true,
    tradeEligible: false,
    dataQuality: 'mock',
    ...over,
  };
}

export function makeHolding(
  accountId: string,
  symbol: string,
  shares: number,
  costPerShare: number,
  over: Partial<Holding> = {},
): Holding {
  return {
    id: `${accountId}:${symbol}`,
    accountId,
    symbol: symbol.toUpperCase(),
    shares,
    costBasisTotal: Number((shares * costPerShare).toFixed(4)),
    sleeve: getInstrumentOrFallback(symbol).sleeve,
    ...over,
  };
}

export function makeIncomeEvent(
  accountId: string,
  symbol: string,
  grossAmount: number,
  payDate: string,
  over: Partial<IncomeEvent> = {},
): IncomeEvent {
  return {
    id: `${accountId}:${symbol}:${payDate}`,
    accountId,
    symbol: symbol.toUpperCase(),
    payDate,
    grossAmount,
    sharesAtRecord: 0,
    reinvested: true,
    ...over,
  };
}

export interface SnapshotParts {
  asOf?: string;
  accounts?: Account[];
  holdings?: Holding[];
  quotes?: Record<string, Quote>;
  distributions?: DistributionEvent[];
  incomeEvents?: IncomeEvent[];
  contributions?: Contribution[];
  priceHistory?: Record<string, PriceBar[]>;
  corporateActions?: CorporateAction[];
  containsMockData?: boolean;
}

export function makeSnapshot(parts: SnapshotParts = {}): PortfolioSnapshot {
  return {
    asOf: parts.asOf ?? AS_OF,
    dataQuality: 'mock',
    containsMockData: parts.containsMockData ?? true,
    sourceNotes: ['Synthetic fixture built by the test suite.'],
    accounts: parts.accounts ?? [],
    holdings: parts.holdings ?? [],
    quotes: parts.quotes ?? {},
    distributions: parts.distributions ?? [],
    incomeEvents: parts.incomeEvents ?? [],
    contributions: parts.contributions ?? [],
    priceHistory: parts.priceHistory ?? {},
    corporateActions: parts.corporateActions ?? [],
  };
}

/** Quotes keyed by symbol from a simple symbol → price map. */
export function quotesFor(prices: Record<string, number>, extra: Partial<Quote> = {}): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const [symbol, price] of Object.entries(prices)) out[symbol.toUpperCase()] = makeQuote(symbol, price, extra);
  return out;
}
