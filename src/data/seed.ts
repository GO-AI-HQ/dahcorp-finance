/**
 * Seed portfolio model.
 *
 * Turns the fixture anchors into a fully-formed account/holding/contribution
 * model for a given snapshot date. Everything produced here is MOCK data and is
 * labelled as such all the way to the UI. The confirmed real figures — 11 YMAG
 * at Schwab and 7.90 NVDY at Robinhood — are seeded as positions, not as
 * results: every derived number is recomputed from them.
 */
import type { Account, Contribution, CorporateAction, DistributionEvent, Holding, IncomeEvent } from '../core/types.js';
import { getInstrumentOrFallback } from '../core/universe.js';
import { addDays, parseISODate } from '../core/dates.js';
import { SEED_ACCOUNTS, SEED_CONTRIBUTIONS, SEED_CORPORATE_ACTIONS, SEED_HOLDINGS } from './fixtures.js';

export interface SeedModel {
  accounts: Account[];
  holdings: Holding[];
  contributions: Contribution[];
  corporateActions: CorporateAction[];
  /** ISO date each holding was opened, keyed by holding id. */
  openedAt: Record<string, string>;
}

function weeksAgo(asOf: string, weeks: number): string {
  return addDays(asOf, -Math.round(weeks * 7));
}

export function buildSeedModel(asOf: string): SeedModel {
  const accounts: Account[] = SEED_ACCOUNTS.map((a) => ({
    id: a.key,
    broker: a.broker,
    name: a.name,
    type: a.type,
    role: a.role,
    cash: a.cash,
    allocationEligible: a.allocationEligible,
    // Phase 1 is observer-only. No account may transact, ever, in this build.
    tradeEligible: false,
    dataQuality: 'mock',
  }));

  const openedAt: Record<string, string> = {};
  const holdings: Holding[] = SEED_HOLDINGS.map((h) => {
    const id = `${h.accountKey}:${h.symbol}`;
    const opened = weeksAgo(asOf, h.openedWeeksAgo);
    openedAt[id] = opened;
    return {
      id,
      accountId: h.accountKey,
      symbol: h.symbol,
      shares: h.shares,
      costBasisTotal: h.shares * h.costPerShare,
      tacticalCostBasisTotal: h.tacticalCostPerShare != null ? h.shares * h.tacticalCostPerShare : undefined,
      sleeve: getInstrumentOrFallback(h.symbol).sleeve,
      legacy: h.legacy,
      openedAt: opened,
    };
  });

  const contributions: Contribution[] = SEED_CONTRIBUTIONS.map((c, i) => ({
    id: `seed-contribution-${i}`,
    accountId: c.accountKey,
    date: weeksAgo(asOf, c.weeksAgo),
    amount: c.amount,
    note: c.note,
  }));

  const corporateActions: CorporateAction[] = SEED_CORPORATE_ACTIONS.map((a) => ({
    symbol: a.symbol,
    effectiveDate: weeksAgo(asOf, a.weeksAgo),
    type: a.type,
    ratio: a.ratio,
  }));

  return { accounts, holdings, contributions, corporateActions, openedAt };
}

/**
 * Synthesises the received-income history implied by the seeded positions.
 *
 * Real income events will come from the brokers. Until then these are derived
 * from the mock distribution calendar so that "cash actually received" is a
 * separate, auditable number from "modeled forward income" — never the same
 * figure wearing two hats.
 */
export function buildSeedIncomeEvents(
  holdings: Holding[],
  distributions: DistributionEvent[],
  asOf: string,
): IncomeEvent[] {
  const events: IncomeEvent[] = [];
  const asOfMs = parseISODate(asOf).getTime();

  for (const holding of holdings) {
    if (!holding.openedAt) continue;
    const openedMs = parseISODate(holding.openedAt).getTime();
    const paid = distributions
      .filter((d) => d.symbol === holding.symbol.toUpperCase())
      .filter((d) => {
        const pay = parseISODate(d.payDate).getTime();
        return pay >= openedMs && pay <= asOfMs;
      })
      .sort((a, b) => a.payDate.localeCompare(b.payDate));
    if (!paid.length) continue;

    // Shares are modeled as having grown linearly from the opening purchase to
    // the current count, so early payments are not credited on today's shares.
    const openingShares = holding.shares * 0.72;
    for (const [i, dist] of paid.entries()) {
      const progress = paid.length > 1 ? i / (paid.length - 1) : 1;
      const shares = openingShares + (holding.shares - openingShares) * progress;
      const gross = shares * dist.amountPerShare;
      if (gross < 0.005) continue;
      events.push({
        id: `${holding.id}:${dist.payDate}`,
        accountId: holding.accountId,
        symbol: holding.symbol.toUpperCase(),
        payDate: dist.payDate,
        grossAmount: gross,
        sharesAtRecord: shares,
        reinvested: true,
      });
    }
  }

  return events.sort((a, b) => b.payDate.localeCompare(a.payDate));
}
