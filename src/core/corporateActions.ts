import type { CorporateAction, DistributionEvent, Holding, PriceBar } from './types.js';

/**
 * Corporate-action adjustment.
 *
 * Raw historical share counts are never a valid portfolio goal: a 1-for-10
 * reverse split turns 100 shares into 10 without changing a dollar of value,
 * and a "shares required for one share/month" target computed against
 * unadjusted history would be wrong by 10x.
 *
 * These helpers restate historical series into current-share terms so the
 * economic measures — market value, cash flow, total return — stay correct
 * across splits, ticker changes and mergers.
 */

/** Cumulative split factor applied to data dated before each action. */
export function cumulativeSplitFactor(actions: CorporateAction[], onOrBeforeDate: string): number {
  let factor = 1;
  for (const a of actions) {
    if (a.type !== 'split' && a.type !== 'reverse_split') continue;
    if (!a.ratio || a.ratio <= 0) continue;
    // Data dated before the effective date is expressed in pre-split units.
    if (onOrBeforeDate < a.effectiveDate) factor *= a.ratio;
  }
  return factor;
}

/** Restate historical closes into today's share terms. */
export function adjustPriceHistory(bars: PriceBar[], actions: CorporateAction[]): PriceBar[] {
  if (!actions.length) return bars;
  return bars.map((bar) => {
    const factor = cumulativeSplitFactor(actions, bar.date);
    return factor === 1 ? bar : { date: bar.date, close: bar.close / factor };
  });
}

/**
 * Restate historical per-share distributions into today's share terms.
 * A pre-2-for-1-split payment of $0.40/share is $0.20/share in current units.
 */
export function adjustDistributions(
  events: DistributionEvent[],
  actions: CorporateAction[],
): DistributionEvent[] {
  if (!actions.length) return events;
  return events.map((event) => {
    const factor = cumulativeSplitFactor(
      actions.filter((a) => a.symbol === event.symbol),
      event.payDate,
    );
    return factor === 1 ? event : { ...event, amountPerShare: event.amountPerShare / factor };
  });
}

/** Follow ticker-change and merger records to the symbol trading today. */
export function resolveCurrentSymbol(symbol: string, actions: CorporateAction[]): string {
  let current = symbol.toUpperCase();
  const renames = actions
    .filter((a) => (a.type === 'ticker_change' || a.type === 'merger') && a.newSymbol)
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  for (const rename of renames) {
    if (rename.symbol.toUpperCase() === current && rename.newSymbol) current = rename.newSymbol.toUpperCase();
  }
  return current;
}

/**
 * Apply splits and ticker changes to live holdings. Cost basis in dollars is
 * unchanged by a split; only the share count moves.
 */
export function applyActionsToHoldings(holdings: Holding[], actions: CorporateAction[], asOf: string): Holding[] {
  if (!actions.length) return holdings;
  return holdings.map((holding) => {
    const own = actions.filter((a) => a.symbol.toUpperCase() === holding.symbol.toUpperCase() && a.effectiveDate <= asOf);
    if (!own.length) return holding;
    let shares = holding.shares;
    for (const action of own) {
      if ((action.type === 'split' || action.type === 'reverse_split') && action.ratio && action.ratio > 0) {
        shares *= action.ratio;
      }
    }
    const symbol = resolveCurrentSymbol(holding.symbol, own);
    return { ...holding, shares, symbol };
  });
}

/**
 * Cash paid in lieu of a fractional share. This is a realised proceed, not a
 * distribution, and must never be counted as portfolio income.
 */
export function cashInLieuTotal(actions: CorporateAction[], holdings: Holding[]): number {
  let total = 0;
  for (const action of actions) {
    if (action.type !== 'cash_in_lieu' || !action.cashPerShare) continue;
    for (const h of holdings) {
      if (h.symbol.toUpperCase() !== action.symbol.toUpperCase()) continue;
      const fractional = h.shares % 1;
      total += fractional * action.cashPerShare;
    }
  }
  return total;
}
