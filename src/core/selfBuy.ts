import { WEEKS_PER_MONTH, WEEKS_PER_YEAR, safeDiv } from './math.js';

/**
 * Self-Buy Ratio — how many additional shares a position's own distributions
 * can purchase with no external money.
 *
 * Every input is supplied by the caller from current market and distribution
 * data. Nothing here is hard-coded, so the numbers move as prices and
 * distributions move.
 */
export interface SelfBuyResult {
  /** Shares the position's distributions buy per week. */
  sharesPerWeek: number;
  /** Shares bought per average month (52/12 weeks). */
  sharesPerMonth: number;
  /** Shares bought per year. */
  sharesPerYear: number;
  /** Dollars of distribution per week / month / year for the whole position. */
  weeklyDistribution: number;
  monthlyDistribution: number;
  annualDistribution: number;
  /** Monthly self-buy ratio: total monthly distribution ÷ current share price. */
  monthlySelfBuyRatio: number;
  /** Shares needed for the position to buy one share per month, by itself. */
  sharesRequiredForOnePerMonth: number | null;
  /** Shares needed for the position to buy one share per week, by itself. */
  sharesRequiredForOnePerWeek: number | null;
  /** Progress toward one self-purchased share per month (0-1, uncapped above 1). */
  progressToOnePerMonth: number | null;
  /** Dollars of capital still required to reach one share/month at this price. */
  capitalRequiredForOnePerMonth: number | null;
  /** True when the position already buys at least one share per month. */
  selfFundingMonthly: boolean;
  selfFundingWeekly: boolean;
}

export interface SelfBuyInput {
  shares: number;
  price: number;
  /** Average weekly distribution per share on the chosen basis. */
  weeklyPerShare: number | null;
  /** Monthly distribution per share; defaults to weekly × 52/12. */
  monthlyPerShare?: number | null;
}

export function computeSelfBuy(input: SelfBuyInput): SelfBuyResult {
  const { shares, price } = input;
  const weeklyPerShare = input.weeklyPerShare ?? 0;
  const monthlyPer = input.monthlyPerShare ?? weeklyPerShare * WEEKS_PER_MONTH;

  const weeklyDistribution = shares * weeklyPerShare;
  const monthlyDistribution = shares * monthlyPer;
  const annualDistribution = shares * weeklyPerShare * WEEKS_PER_YEAR;

  const sharesPerWeek = safeDiv(weeklyDistribution, price);
  const sharesPerMonth = safeDiv(monthlyDistribution, price);
  const sharesPerYear = safeDiv(annualDistribution, price);

  // required_shares = current_share_price / monthly_distribution_per_share
  const sharesRequiredForOnePerMonth = monthlyPer > 0 && price > 0 ? price / monthlyPer : null;
  // required_shares = current_share_price / avg_weekly_distribution
  const sharesRequiredForOnePerWeek = weeklyPerShare > 0 && price > 0 ? price / weeklyPerShare : null;

  const progressToOnePerMonth = sharesRequiredForOnePerMonth
    ? safeDiv(shares, sharesRequiredForOnePerMonth)
    : null;

  const capitalRequiredForOnePerMonth = sharesRequiredForOnePerMonth
    ? Math.max(0, (sharesRequiredForOnePerMonth - shares) * price)
    : null;

  return {
    sharesPerWeek,
    sharesPerMonth,
    sharesPerYear,
    weeklyDistribution,
    monthlyDistribution,
    annualDistribution,
    monthlySelfBuyRatio: sharesPerMonth,
    sharesRequiredForOnePerMonth,
    sharesRequiredForOnePerWeek,
    progressToOnePerMonth,
    capitalRequiredForOnePerMonth,
    selfFundingMonthly: sharesPerMonth >= 1,
    selfFundingWeekly: sharesPerWeek >= 1,
  };
}

/**
 * Combined self-funding milestone across several positions: the total capital
 * still needed for every named position to buy one share per month on its own.
 *
 * The investor's earlier ~$735-750 figure was one instance of this calculation
 * at one moment. It is recomputed here from live inputs every time.
 */
export interface SelfFundingMilestone {
  perSymbol: {
    symbol: string;
    shares: number;
    price: number;
    sharesRequired: number | null;
    sharesRemaining: number | null;
    capitalRequired: number | null;
    progress: number | null;
  }[];
  totalCapitalRequired: number;
  /** Fraction of the combined milestone already funded (0-1). */
  combinedProgress: number;
  allSelfFunding: boolean;
}

export function computeSelfFundingMilestone(
  positions: { symbol: string; shares: number; price: number; selfBuy: SelfBuyResult }[],
): SelfFundingMilestone {
  const perSymbol = positions.map((p) => ({
    symbol: p.symbol,
    shares: p.shares,
    price: p.price,
    sharesRequired: p.selfBuy.sharesRequiredForOnePerMonth,
    sharesRemaining: p.selfBuy.sharesRequiredForOnePerMonth
      ? Math.max(0, p.selfBuy.sharesRequiredForOnePerMonth - p.shares)
      : null,
    capitalRequired: p.selfBuy.capitalRequiredForOnePerMonth,
    progress: p.selfBuy.progressToOnePerMonth,
  }));

  const totalCapitalRequired = perSymbol.reduce((acc, p) => acc + (p.capitalRequired ?? 0), 0);
  // Combined progress is measured in dollars-of-milestone, so a position that is
  // nearly funded is not flattered by one that is barely started.
  const totalMilestoneValue = perSymbol.reduce(
    (acc, p) => acc + (p.sharesRequired ? p.sharesRequired * p.price : 0),
    0,
  );
  const fundedValue = perSymbol.reduce(
    (acc, p) => acc + (p.sharesRequired ? Math.min(p.shares, p.sharesRequired) * p.price : 0),
    0,
  );

  return {
    perSymbol,
    totalCapitalRequired,
    combinedProgress: safeDiv(fundedValue, totalMilestoneValue),
    allSelfFunding: perSymbol.length > 0 && perSymbol.every((p) => (p.progress ?? 0) >= 1),
  };
}
