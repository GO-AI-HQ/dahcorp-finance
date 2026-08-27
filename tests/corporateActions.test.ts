import { describe, expect, it } from 'vitest';
import type { CorporateAction } from '../src/core/types.js';
import {
  adjustDistributions,
  adjustPriceHistory,
  applyActionsToHoldings,
  cashInLieuTotal,
  cumulativeSplitFactor,
  resolveCurrentSymbol,
} from '../src/core/corporateActions.js';
import { makeHolding, payments } from './helpers.js';

const SPLIT_2FOR1: CorporateAction = {
  symbol: 'NVDY',
  effectiveDate: '2026-03-01',
  type: 'split',
  ratio: 2,
};

const REVERSE_1FOR10: CorporateAction = {
  symbol: 'SOXL',
  effectiveDate: '2026-03-01',
  type: 'reverse_split',
  ratio: 0.1,
};

describe('cumulativeSplitFactor', () => {
  it('applies to data dated before the effective date only', () => {
    expect(cumulativeSplitFactor([SPLIT_2FOR1], '2026-02-28')).toBe(2);
    expect(cumulativeSplitFactor([SPLIT_2FOR1], '2026-03-01')).toBe(1);
    expect(cumulativeSplitFactor([SPLIT_2FOR1], '2026-06-30')).toBe(1);
  });

  it('compounds multiple splits', () => {
    const second: CorporateAction = { ...SPLIT_2FOR1, effectiveDate: '2026-05-01', ratio: 3 };
    expect(cumulativeSplitFactor([SPLIT_2FOR1, second], '2026-01-01')).toBe(6);
    expect(cumulativeSplitFactor([SPLIT_2FOR1, second], '2026-04-01')).toBe(3);
  });

  it('ignores non-split actions and unusable ratios', () => {
    const noise: CorporateAction[] = [
      { symbol: 'NVDY', effectiveDate: '2026-05-01', type: 'ticker_change', newSymbol: 'NVDX' },
      { symbol: 'NVDY', effectiveDate: '2026-05-01', type: 'split', ratio: 0 },
      { symbol: 'NVDY', effectiveDate: '2026-05-01', type: 'split' },
    ];
    expect(cumulativeSplitFactor(noise, '2026-01-01')).toBe(1);
  });
});

describe('adjustPriceHistory', () => {
  it('restates pre-split closes into current share terms', () => {
    const bars = [
      { date: '2026-02-27', close: 24 },
      { date: '2026-03-02', close: 12 },
    ];
    const adjusted = adjustPriceHistory(bars, [SPLIT_2FOR1]);
    // A 2-for-1 halves the price: $24 pre-split is $12 in today's units, so the
    // series shows no artificial 50% crash on the effective date.
    expect(adjusted.map((b) => b.close)).toEqual([12, 12]);
  });

  it('restates a reverse split upward', () => {
    const bars = [{ date: '2026-02-27', close: 2 }];
    expect(adjustPriceHistory(bars, [REVERSE_1FOR10])[0].close).toBeCloseTo(20, 12);
  });

  it('returns the original bars when there are no actions', () => {
    const bars = [{ date: '2026-02-27', close: 24 }];
    expect(adjustPriceHistory(bars, [])).toBe(bars);
  });
});

describe('adjustDistributions', () => {
  it('halves pre-split per-share payments so cash-flow history stays comparable', () => {
    const events = payments('NVDY', [0.4, 0.4], { asOf: '2026-06-30', intervalDays: 150 });
    // Newest payment is post-split; the earlier one lands before 2026-03-01.
    const adjusted = adjustDistributions(events, [SPLIT_2FOR1]);
    expect(adjusted[0].payDate < SPLIT_2FOR1.effectiveDate).toBe(true);
    expect(adjusted[0].amountPerShare).toBeCloseTo(0.2, 12);
    expect(adjusted[1].amountPerShare).toBeCloseTo(0.4, 12);
  });

  it('only applies actions belonging to the same symbol', () => {
    const events = payments('YMAG', [0.4], { asOf: '2026-01-01' });
    expect(adjustDistributions(events, [SPLIT_2FOR1])[0].amountPerShare).toBe(0.4);
  });
});

describe('resolveCurrentSymbol', () => {
  it('follows a chain of ticker changes and mergers in date order', () => {
    const actions: CorporateAction[] = [
      { symbol: 'BBB', effectiveDate: '2026-05-01', type: 'merger', newSymbol: 'CCC' },
      { symbol: 'AAA', effectiveDate: '2026-02-01', type: 'ticker_change', newSymbol: 'BBB' },
    ];
    expect(resolveCurrentSymbol('AAA', actions)).toBe('CCC');
    expect(resolveCurrentSymbol('aaa', actions)).toBe('CCC');
  });

  it('leaves unrelated symbols alone', () => {
    expect(resolveCurrentSymbol('NVDY', [])).toBe('NVDY');
  });
});

describe('applyActionsToHoldings', () => {
  it('multiplies shares and leaves dollar cost basis untouched', () => {
    const holding = makeHolding('rh-1', 'NVDY', 7.9, 12.5);
    const [adjusted] = applyActionsToHoldings([holding], [SPLIT_2FOR1], '2026-06-30');
    expect(adjusted.shares).toBeCloseTo(15.8, 12);
    expect(adjusted.costBasisTotal).toBe(holding.costBasisTotal);
    // Value is unchanged: twice the shares at half the price.
    expect(adjusted.shares * 6.25).toBeCloseTo(holding.shares * 12.5, 12);
  });

  it('reduces shares on a reverse split — so a raw historical share count is never the goal', () => {
    const holding = makeHolding('sch-1', 'SOXL', 100, 20);
    const [adjusted] = applyActionsToHoldings([holding], [REVERSE_1FOR10], '2026-06-30');
    expect(adjusted.shares).toBeCloseTo(10, 12);
  });

  it('ignores actions dated after the snapshot', () => {
    const holding = makeHolding('rh-1', 'NVDY', 7.9, 12.5);
    const [adjusted] = applyActionsToHoldings([holding], [SPLIT_2FOR1], '2026-02-01');
    expect(adjusted.shares).toBe(7.9);
  });

  it('renames the holding when the ticker changed', () => {
    const actions: CorporateAction[] = [
      { symbol: 'NVDY', effectiveDate: '2026-02-01', type: 'ticker_change', newSymbol: 'NVDX' },
    ];
    const [adjusted] = applyActionsToHoldings([makeHolding('rh-1', 'NVDY', 7.9, 12.5)], actions, '2026-06-30');
    expect(adjusted.symbol).toBe('NVDX');
    expect(adjusted.shares).toBe(7.9);
  });
});

describe('cashInLieuTotal', () => {
  it('values only the fractional part of the position', () => {
    const actions: CorporateAction[] = [
      { symbol: 'NVDY', effectiveDate: '2026-03-01', type: 'cash_in_lieu', cashPerShare: 10 },
    ];
    // 7.90 shares → 0.90 fractional × $10.
    expect(cashInLieuTotal(actions, [makeHolding('rh-1', 'NVDY', 7.9, 12.5)])).toBeCloseTo(9, 6);
  });

  it('is zero for whole-share positions and unrelated actions', () => {
    const actions: CorporateAction[] = [
      { symbol: 'YMAG', effectiveDate: '2026-03-01', type: 'cash_in_lieu', cashPerShare: 10 },
    ];
    expect(cashInLieuTotal(actions, [makeHolding('sch-1', 'YMAG', 11, 11.12)])).toBe(0);
    expect(cashInLieuTotal(actions, [makeHolding('rh-1', 'NVDY', 7.9, 12.5)])).toBe(0);
  });
});
