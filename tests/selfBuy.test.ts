import { describe, expect, it } from 'vitest';
import { computeSelfBuy, computeSelfFundingMilestone } from '../src/core/selfBuy.js';
import { WEEKS_PER_MONTH, WEEKS_PER_YEAR } from '../src/core/math.js';

const PRICE = 12.5;
const WEEKLY_PER_SHARE = 0.2;
const SHARES = 7.9;

describe('computeSelfBuy', () => {
  const result = computeSelfBuy({ shares: SHARES, price: PRICE, weeklyPerShare: WEEKLY_PER_SHARE });

  it('derives the monthly per-share distribution as weekly × 52 / 12', () => {
    // monthly_distribution_per_share = avg_weekly_distribution × 52 / 12
    expect(result.monthlyDistribution).toBeCloseTo(SHARES * WEEKLY_PER_SHARE * WEEKS_PER_MONTH, 10);
    expect(result.annualDistribution).toBeCloseTo(SHARES * WEEKLY_PER_SHARE * WEEKS_PER_YEAR, 10);
  });

  it('computes the monthly self-buy ratio as monthly distribution ÷ share price', () => {
    // monthly_self_buy_ratio = total_monthly_distribution / current_share_price
    expect(result.monthlySelfBuyRatio).toBeCloseTo(result.monthlyDistribution / PRICE, 12);
    expect(result.sharesPerMonth).toBe(result.monthlySelfBuyRatio);
    expect(result.sharesPerWeek).toBeCloseTo((SHARES * WEEKLY_PER_SHARE) / PRICE, 12);
  });

  it('computes required shares as price ÷ per-share distribution', () => {
    // required_shares = current_share_price / monthly_distribution_per_share
    expect(result.sharesRequiredForOnePerMonth).toBeCloseTo(PRICE / (WEEKLY_PER_SHARE * WEEKS_PER_MONTH), 10);
    // required_shares = current_share_price / avg_weekly_distribution
    expect(result.sharesRequiredForOnePerWeek).toBeCloseTo(PRICE / WEEKLY_PER_SHARE, 10);
  });

  it('reports progress and the remaining capital to one self-purchased share per month', () => {
    const required = result.sharesRequiredForOnePerMonth!;
    expect(result.progressToOnePerMonth).toBeCloseTo(SHARES / required, 10);
    expect(result.capitalRequiredForOnePerMonth).toBeCloseTo((required - SHARES) * PRICE, 8);
    expect(result.selfFundingMonthly).toBe(false);
    expect(result.selfFundingWeekly).toBe(false);
  });

  it('moves with price and distribution rather than holding a fixed target', () => {
    const doubledPrice = computeSelfBuy({ shares: SHARES, price: PRICE * 2, weeklyPerShare: WEEKLY_PER_SHARE });
    expect(doubledPrice.sharesRequiredForOnePerMonth).toBeCloseTo(result.sharesRequiredForOnePerMonth! * 2, 8);

    const halvedDistribution = computeSelfBuy({ shares: SHARES, price: PRICE, weeklyPerShare: WEEKLY_PER_SHARE / 2 });
    expect(halvedDistribution.sharesRequiredForOnePerMonth).toBeCloseTo(result.sharesRequiredForOnePerMonth! * 2, 8);
  });

  it('flags a position that already buys a share per month, and one per week', () => {
    const monthly = computeSelfBuy({ shares: 20, price: PRICE, weeklyPerShare: WEEKLY_PER_SHARE });
    expect(monthly.selfFundingMonthly).toBe(true);
    expect(monthly.selfFundingWeekly).toBe(false);
    expect(monthly.capitalRequiredForOnePerMonth).toBe(0);

    const weekly = computeSelfBuy({ shares: 100, price: PRICE, weeklyPerShare: WEEKLY_PER_SHARE });
    expect(weekly.selfFundingWeekly).toBe(true);
  });

  it('honours an explicit monthly per-share figure over the weekly conversion', () => {
    const explicit = computeSelfBuy({
      shares: SHARES,
      price: PRICE,
      weeklyPerShare: WEEKLY_PER_SHARE,
      monthlyPerShare: 1,
    });
    expect(explicit.monthlyDistribution).toBeCloseTo(SHARES, 10);
    expect(explicit.sharesRequiredForOnePerMonth).toBeCloseTo(PRICE, 10);
    // The annual figure still comes from the weekly cadence.
    expect(explicit.annualDistribution).toBeCloseTo(SHARES * WEEKLY_PER_SHARE * WEEKS_PER_YEAR, 10);
  });

  it('returns nulls rather than guesses when there is no distribution history', () => {
    const none = computeSelfBuy({ shares: SHARES, price: PRICE, weeklyPerShare: null });
    expect(none.monthlyDistribution).toBe(0);
    expect(none.sharesRequiredForOnePerMonth).toBeNull();
    expect(none.sharesRequiredForOnePerWeek).toBeNull();
    expect(none.progressToOnePerMonth).toBeNull();
    expect(none.capitalRequiredForOnePerMonth).toBeNull();
    expect(none.selfFundingMonthly).toBe(false);
  });

  it('never divides by a zero price', () => {
    const noPrice = computeSelfBuy({ shares: SHARES, price: 0, weeklyPerShare: WEEKLY_PER_SHARE });
    expect(Number.isFinite(noPrice.sharesPerMonth)).toBe(true);
    expect(noPrice.sharesPerMonth).toBe(0);
    expect(noPrice.sharesRequiredForOnePerMonth).toBeNull();
  });
});

describe('computeSelfFundingMilestone', () => {
  const nvdy = { symbol: 'NVDY', shares: 7.9, price: 12.5 };
  const ymag = { symbol: 'YMAG', shares: 11, price: 11.12 };
  const positions = [
    { ...nvdy, selfBuy: computeSelfBuy({ ...nvdy, weeklyPerShare: 0.2 }) },
    { ...ymag, selfBuy: computeSelfBuy({ ...ymag, weeklyPerShare: 0.16 }) },
  ];

  it('sums the capital still required across positions', () => {
    const milestone = computeSelfFundingMilestone(positions);
    const expected =
      positions[0].selfBuy.capitalRequiredForOnePerMonth! + positions[1].selfBuy.capitalRequiredForOnePerMonth!;
    expect(milestone.totalCapitalRequired).toBeCloseTo(expected, 8);
    expect(milestone.perSymbol.map((p) => p.symbol)).toEqual(['NVDY', 'YMAG']);
    expect(milestone.allSelfFunding).toBe(false);
  });

  it('measures combined progress in dollars of milestone, not in share counts', () => {
    const milestone = computeSelfFundingMilestone(positions);
    const totalValue = milestone.perSymbol.reduce((acc, p) => acc + p.sharesRequired! * p.price, 0);
    const funded = milestone.perSymbol.reduce((acc, p) => acc + Math.min(p.shares, p.sharesRequired!) * p.price, 0);
    expect(milestone.combinedProgress).toBeCloseTo(funded / totalValue, 10);
    expect(milestone.combinedProgress).toBeGreaterThan(0);
    expect(milestone.combinedProgress).toBeLessThan(1);
  });

  it('reports completion only when every position funds a share a month on its own', () => {
    const funded = positions.map((p) => {
      const shares = p.selfBuy.sharesRequiredForOnePerMonth! + 1;
      return { ...p, shares, selfBuy: computeSelfBuy({ shares, price: p.price, weeklyPerShare: 0.2 }) };
    });
    const milestone = computeSelfFundingMilestone(funded);
    expect(milestone.allSelfFunding).toBe(true);
    expect(milestone.totalCapitalRequired).toBe(0);
    expect(milestone.combinedProgress).toBeCloseTo(1, 10);
  });

  it('is empty rather than complete when there are no positions', () => {
    const milestone = computeSelfFundingMilestone([]);
    expect(milestone.perSymbol).toHaveLength(0);
    expect(milestone.allSelfFunding).toBe(false);
    expect(milestone.totalCapitalRequired).toBe(0);
  });
});
