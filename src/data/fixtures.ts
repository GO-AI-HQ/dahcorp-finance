/**
 * MOCK FIXTURE ANCHORS — NOT MARKET DATA.
 *
 * Every number in this file is a synthetic anchor used to generate a plausible
 * demonstration dataset while no live provider is connected. They are rough
 * order-of-magnitude placeholders, they are not quotes, and they must never be
 * treated as facts about the market.
 *
 * The calculation engine in `src/core` never reads this file. It receives
 * prices and distributions as arguments, so replacing this module with a live
 * provider changes no arithmetic anywhere in the application.
 *
 * Replace by implementing `MarketDataProvider` in `src/market/provider.ts`
 * against a real quote and distribution source.
 */

export interface FixtureAnchor {
  symbol: string;
  /** Synthetic current price. */
  price: number;
  /** Synthetic 52-week price drift, as a fraction. Negative = NAV erosion. */
  drift52w: number;
  /** Synthetic annualised volatility, used to shape the generated path. */
  volatility: number;
  /** Average daily share volume. */
  avgVolume: number;
  /** Half-spread as a fraction of price. */
  halfSpread: number;
  /**
   * Synthetic per-payment distribution at the stated cadence.
   * Weekly payers: per-week. Monthly: per-month. Quarterly: per-quarter.
   */
  distribution?: number;
  /** Synthetic per-payment trend over the trailing year, as a fraction. */
  distributionDrift?: number;
  /** Synthetic return-of-capital share of distributions (0-1). */
  returnOfCapitalPct?: number;
}

export const FIXTURE_ANCHORS: FixtureAnchor[] = [
  // ── Income engine — YieldMax and peers ────────────────────────────────────
  // NVDY and YMAG anchors are chosen so the generated dataset lands near the
  // investor's own observed micro-milestone (~32 YMAG / ~31 NVDY shares to
  // self-purchase one share per average month). The app recomputes that
  // milestone from the generated data rather than reading it from here.
  { symbol: 'NVDY', price: 12.48, drift52w: -0.19, volatility: 0.52, avgVolume: 3_900_000, halfSpread: 0.0009, distribution: 0.0931, distributionDrift: -0.14, returnOfCapitalPct: 0.68 },
  { symbol: 'YMAG', price: 11.12, drift52w: -0.09, volatility: 0.34, avgVolume: 640_000, halfSpread: 0.0013, distribution: 0.0802, distributionDrift: -0.08, returnOfCapitalPct: 0.61 },
  { symbol: 'YMAX', price: 13.21, drift52w: -0.12, volatility: 0.31, avgVolume: 1_450_000, halfSpread: 0.0011, distribution: 0.1046, distributionDrift: -0.1, returnOfCapitalPct: 0.64 },
  { symbol: 'AMZY', price: 17.44, drift52w: -0.06, volatility: 0.39, avgVolume: 410_000, halfSpread: 0.0016, distribution: 0.1148, distributionDrift: -0.05, returnOfCapitalPct: 0.55 },
  { symbol: 'MSFO', price: 16.93, drift52w: -0.11, volatility: 0.33, avgVolume: 205_000, halfSpread: 0.0021, distribution: 0.0996, distributionDrift: -0.09, returnOfCapitalPct: 0.59 },
  { symbol: 'CHPY', price: 24.61, drift52w: 0.04, volatility: 0.42, avgVolume: 320_000, halfSpread: 0.0018, distribution: 0.1354, distributionDrift: -0.02, returnOfCapitalPct: 0.47 },
  { symbol: 'TSMY', price: 19.07, drift52w: 0.02, volatility: 0.45, avgVolume: 148_000, halfSpread: 0.0027, distribution: 0.1211, distributionDrift: -0.03, returnOfCapitalPct: 0.52 },
  { symbol: 'QQQI', price: 52.38, drift52w: 0.081, volatility: 0.19, avgVolume: 780_000, halfSpread: 0.0005, distribution: 0.6214, distributionDrift: 0.01, returnOfCapitalPct: 0.21 },
  { symbol: 'SPYI', price: 51.06, drift52w: 0.062, volatility: 0.15, avgVolume: 690_000, halfSpread: 0.0005, distribution: 0.5108, distributionDrift: 0.0, returnOfCapitalPct: 0.18 },
  { symbol: 'JEPQ', price: 54.72, drift52w: 0.094, volatility: 0.18, avgVolume: 4_100_000, halfSpread: 0.0003, distribution: 0.4587, distributionDrift: 0.02, returnOfCapitalPct: 0.09 },

  // ── Core growth ───────────────────────────────────────────────────────────
  { symbol: 'GOOGL', price: 206.34, drift52w: 0.238, volatility: 0.29, avgVolume: 24_800_000, halfSpread: 0.0002, distribution: 0.21, distributionDrift: 0.05 },
  { symbol: 'AMZN', price: 227.81, drift52w: 0.171, volatility: 0.31, avgVolume: 33_200_000, halfSpread: 0.0002 },
  { symbol: 'WMT', price: 97.62, drift52w: 0.146, volatility: 0.21, avgVolume: 17_400_000, halfSpread: 0.0002, distribution: 0.235, distributionDrift: 0.09 },
  { symbol: 'TSM', price: 284.19, drift52w: 0.412, volatility: 0.36, avgVolume: 12_600_000, halfSpread: 0.0002, distribution: 0.6987, distributionDrift: 0.12 },
  { symbol: 'CCJ', price: 77.94, drift52w: 0.318, volatility: 0.47, avgVolume: 5_900_000, halfSpread: 0.0004, distribution: 0.16, distributionDrift: 0.0 },
  { symbol: 'SMH', price: 331.47, drift52w: 0.294, volatility: 0.34, avgVolume: 6_700_000, halfSpread: 0.0002, distribution: 0.9412, distributionDrift: 0.06 },

  // ── Semiconductor research universe ───────────────────────────────────────
  { symbol: 'ASML', price: 812.55, drift52w: 0.268, volatility: 0.35, avgVolume: 1_900_000, halfSpread: 0.0003, distribution: 1.7412, distributionDrift: 0.08 },
  { symbol: 'QCOM', price: 161.28, drift52w: 0.043, volatility: 0.3, avgVolume: 7_800_000, halfSpread: 0.0002, distribution: 0.89, distributionDrift: 0.07 },
  { symbol: 'TXN', price: 184.71, drift52w: 0.058, volatility: 0.26, avgVolume: 5_400_000, halfSpread: 0.0002, distribution: 1.36, distributionDrift: 0.05 },
  { symbol: 'GFS', price: 39.86, drift52w: -0.041, volatility: 0.42, avgVolume: 2_100_000, halfSpread: 0.0005 },
  { symbol: 'FTXL', price: 112.94, drift52w: 0.221, volatility: 0.33, avgVolume: 68_000, halfSpread: 0.0014, distribution: 0.2841, distributionDrift: 0.03 },
  { symbol: 'MU', price: 214.63, drift52w: 0.487, volatility: 0.51, avgVolume: 19_700_000, halfSpread: 0.0002, distribution: 0.115, distributionDrift: 0.0 },
  { symbol: 'AMD', price: 163.42, drift52w: 0.126, volatility: 0.46, avgVolume: 31_400_000, halfSpread: 0.0002 },
  { symbol: 'MRVL', price: 94.17, drift52w: 0.088, volatility: 0.44, avgVolume: 12_900_000, halfSpread: 0.0003, distribution: 0.06, distributionDrift: 0.0 },
  { symbol: 'NVDA', price: 181.06, drift52w: 0.352, volatility: 0.44, avgVolume: 168_000_000, halfSpread: 0.0001, distribution: 0.01, distributionDrift: 0.0 },
  { symbol: 'SEMI', price: 34.72, drift52w: 0.204, volatility: 0.32, avgVolume: 42_000, halfSpread: 0.0019, distribution: 0.0812, distributionDrift: 0.02 },

  // ── Tactical leveraged ────────────────────────────────────────────────────
  { symbol: 'TSMX', price: 34.86, drift52w: 0.681, volatility: 0.72, avgVolume: 214_000, halfSpread: 0.0024 },
  { symbol: 'SOXL', price: 27.94, drift52w: 0.544, volatility: 1.02, avgVolume: 58_400_000, halfSpread: 0.0004, distribution: 0.0341, distributionDrift: 0.0 },

  // ── Shipping / cyclical ───────────────────────────────────────────────────
  { symbol: 'DAC', price: 91.47, drift52w: 0.112, volatility: 0.38, avgVolume: 148_000, halfSpread: 0.0012, distribution: 0.85, distributionDrift: 0.0 },
  { symbol: 'INSW', price: 39.83, drift52w: -0.088, volatility: 0.41, avgVolume: 640_000, halfSpread: 0.0007, distribution: 0.12, distributionDrift: -0.22 },
  { symbol: 'GSL', price: 23.71, drift52w: 0.061, volatility: 0.36, avgVolume: 390_000, halfSpread: 0.0009, distribution: 0.525, distributionDrift: 0.05 },
  { symbol: 'CMBT', price: 10.94, drift52w: -0.184, volatility: 0.44, avgVolume: 520_000, halfSpread: 0.0014, distribution: 0.05, distributionDrift: -0.4 },

  // ── REIT / dividend core ──────────────────────────────────────────────────
  { symbol: 'O', price: 57.16, drift52w: 0.037, volatility: 0.19, avgVolume: 5_100_000, halfSpread: 0.0003, distribution: 0.2695, distributionDrift: 0.03 },
  { symbol: 'STAG', price: 34.82, drift52w: -0.024, volatility: 0.22, avgVolume: 1_400_000, halfSpread: 0.0005, distribution: 0.1242, distributionDrift: 0.02 },
  { symbol: 'VNQ', price: 91.68, drift52w: 0.019, volatility: 0.2, avgVolume: 3_600_000, halfSpread: 0.0003, distribution: 0.9481, distributionDrift: 0.01 },
  { symbol: 'SCHD', price: 27.31, drift52w: 0.068, volatility: 0.16, avgVolume: 14_200_000, halfSpread: 0.0004, distribution: 0.2618, distributionDrift: 0.06 },
];

export const ANCHORS_BY_SYMBOL = new Map(FIXTURE_ANCHORS.map((a) => [a.symbol, a]));

/**
 * Confirmed seed holdings.
 *
 * Only NVDY (Robinhood) and YMAG (Schwab) are confirmed. The small Schwab
 * fractions in TSM, CCJ and SOXL are marked `legacy` and are treated as
 * remnants rather than active theses until live brokerage data is connected.
 */
export interface SeedHolding {
  accountKey: 'robinhood_taxable' | 'schwab_taxable' | 'roth_ira' | 'education_coverdell';
  symbol: string;
  shares: number;
  /** Cost basis per share used to derive the total. Synthetic. */
  costPerShare: number;
  /** Tactical basis per share for leveraged harvest math. Synthetic. */
  tacticalCostPerShare?: number;
  legacy?: boolean;
  /** Weeks ago the position was opened; drives synthetic received-income history. */
  openedWeeksAgo: number;
}

export const SEED_HOLDINGS: SeedHolding[] = [
  // Confirmed.
  { accountKey: 'robinhood_taxable', symbol: 'NVDY', shares: 7.9, costPerShare: 13.41, openedWeeksAgo: 10 },
  { accountKey: 'schwab_taxable', symbol: 'YMAG', shares: 11, costPerShare: 11.58, openedWeeksAgo: 14 },
  // Legacy/minor Schwab fractions, per the investor's note.
  { accountKey: 'schwab_taxable', symbol: 'TSM', shares: 0.1184, costPerShare: 198.42, legacy: true, openedWeeksAgo: 38 },
  { accountKey: 'schwab_taxable', symbol: 'CCJ', shares: 0.2461, costPerShare: 61.08, legacy: true, openedWeeksAgo: 34 },
  { accountKey: 'schwab_taxable', symbol: 'SOXL', shares: 1.4072, costPerShare: 21.36, tacticalCostPerShare: 21.36, legacy: true, openedWeeksAgo: 27 },
  // Secondary accounts — displayed, never allocated to automatically.
  { accountKey: 'roth_ira', symbol: 'SCHD', shares: 41.2836, costPerShare: 24.19, openedWeeksAgo: 96 },
  { accountKey: 'education_coverdell', symbol: 'VNQ', shares: 6.1042, costPerShare: 84.71, openedWeeksAgo: 72 },
];

export const SEED_ACCOUNTS = [
  {
    key: 'robinhood_taxable' as const,
    broker: 'robinhood' as const,
    name: 'Robinhood — Active Accumulation',
    type: 'taxable' as const,
    role: 'Fractional-dollar accumulation, active growth, income engine, tactical opportunities.',
    cash: 82.44,
    allocationEligible: true,
  },
  {
    key: 'schwab_taxable' as const,
    broker: 'schwab' as const,
    name: 'Charles Schwab — Income / Value / Cyclical',
    type: 'taxable' as const,
    role: 'Diversified income, shipping/value, REIT/dividend, slower-moving conviction positions.',
    cash: 146.19,
    allocationEligible: true,
  },
  {
    key: 'roth_ira' as const,
    broker: 'schwab' as const,
    name: 'Roth IRA — Long-Term Compounding',
    type: 'roth_ira' as const,
    role: 'Long-term compounding. Not a Phase 1 focus. Excluded from automated allocation and execution.',
    cash: 18.03,
    allocationEligible: false,
  },
  {
    key: 'education_coverdell' as const,
    broker: 'manual' as const,
    name: 'Education Savings (Coverdell)',
    type: 'education' as const,
    role: 'Future family capital. Separate risk sleeve — never a clone of the taxable strategy.',
    cash: 214.87,
    allocationEligible: false,
  },
];

/** Synthetic external contribution history, for the velocity attribution. */
export const SEED_CONTRIBUTIONS: { accountKey: SeedHolding['accountKey']; weeksAgo: number; amount: number; note: string }[] = [
  { accountKey: 'robinhood_taxable', weeksAgo: 14, amount: 120, note: 'Initial NVDY accumulation' },
  { accountKey: 'schwab_taxable', weeksAgo: 15, amount: 130, note: 'Initial YMAG position' },
  { accountKey: 'robinhood_taxable', weeksAgo: 9, amount: 100, note: 'Recurring contribution' },
  { accountKey: 'schwab_taxable', weeksAgo: 5, amount: 100, note: 'Recurring contribution' },
  { accountKey: 'robinhood_taxable', weeksAgo: 1, amount: 200, note: 'Recurring contribution' },
];

/**
 * Synthetic corporate-action history. Included so the adjustment code path is
 * exercised rather than dormant: this reverse split is why raw historical share
 * counts can never be the portfolio goal.
 */
export const SEED_CORPORATE_ACTIONS = [
  {
    symbol: 'SOXL',
    /** Filled in relative to the snapshot date by the generator. */
    weeksAgo: 44,
    type: 'reverse_split' as const,
    ratio: 0.1,
    note: 'Illustrative 1-for-10 reverse split. Historical prices and distributions before this date are restated.',
  },
];
