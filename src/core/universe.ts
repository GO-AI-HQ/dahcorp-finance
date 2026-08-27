import type { InstrumentMeta, Sleeve } from './types.js';

/**
 * Instrument reference data.
 *
 * This is metadata only — asset class, sleeve default, leverage multiple,
 * distribution cadence, sector and underlying exposure. It contains no prices,
 * no yields and no distribution amounts; those always come from a market-data
 * provider at request time.
 *
 * `exposure` is the key used to detect portfolio overlap: NVDY and NVDA both
 * map to `nvda`, so an option-income fund on NVDA is correctly recognised as
 * concentrated in the same underlying as the stock.
 */
function meta(
  symbol: string,
  name: string,
  assetClass: InstrumentMeta['assetClass'],
  sleeve: Sleeve,
  sector: string,
  exposure: string,
  distributionFrequency: InstrumentMeta['distributionFrequency'],
  leverage = 1,
  notes?: string,
): InstrumentMeta {
  return { symbol, name, assetClass, sleeve, sector, exposure, distributionFrequency, leverage, notes };
}

export const INSTRUMENTS: InstrumentMeta[] = [
  // ── Income engine — YieldMax option-income ETFs ────────────────────────────
  meta('NVDY', 'YieldMax NVDA Option Income Strategy ETF', 'etp', 'income_engine', 'semiconductors', 'nvda', 'weekly', 1,
    'Synthetic covered-call exposure to NVDA. Distributions can include substantial return of capital.'),
  meta('YMAG', 'YieldMax Magnificent 7 Fund of Option Income ETFs', 'etp', 'income_engine', 'mega_cap_tech', 'mag7', 'weekly', 1,
    'Fund-of-funds across YieldMax single-stock income ETFs on the Magnificent 7.'),
  meta('YMAX', 'YieldMax Universe Fund of Option Income ETFs', 'etp', 'income_engine', 'diversified_equity', 'ymax_universe', 'weekly', 1,
    'Broader fund-of-funds across the YieldMax lineup. Lower single-name concentration than NVDY.'),
  meta('AMZY', 'YieldMax AMZN Option Income Strategy ETF', 'etp', 'income_engine', 'consumer_discretionary', 'amzn', 'weekly'),
  meta('MSFO', 'YieldMax MSFT Option Income Strategy ETF', 'etp', 'income_engine', 'software', 'msft', 'weekly'),
  meta('CHPY', 'Amplify Semiconductor Covered Call ETF', 'etp', 'income_engine', 'semiconductors', 'semis_basket', 'weekly'),
  meta('TSMY', 'YieldMax TSM Option Income Strategy ETF', 'etp', 'income_engine', 'semiconductors', 'tsm', 'weekly'),

  // ── Income engine — non-YieldMax option-income / dividend strategies ───────
  meta('QQQI', 'NEOS Nasdaq-100 High Income ETF', 'etp', 'income_engine', 'mega_cap_tech', 'ndx', 'monthly', 1,
    'Index-level call writing with tax-managed structure. Lower headline yield, generally better NAV retention.'),
  meta('SPYI', 'NEOS S&P 500 High Income ETF', 'etp', 'income_engine', 'diversified_equity', 'spx', 'monthly'),
  meta('JEPQ', 'JPMorgan Nasdaq Equity Premium Income ETF', 'etp', 'income_engine', 'mega_cap_tech', 'ndx', 'monthly'),

  // ── Core growth ───────────────────────────────────────────────────────────
  meta('GOOGL', 'Alphabet Inc. Class A', 'equity', 'core_growth', 'internet', 'googl', 'quarterly'),
  meta('AMZN', 'Amazon.com Inc.', 'equity', 'core_growth', 'consumer_discretionary', 'amzn', 'irregular'),
  meta('WMT', 'Walmart Inc.', 'equity', 'core_growth', 'consumer_staples', 'wmt', 'quarterly'),
  meta('TSM', 'Taiwan Semiconductor Manufacturing Co. ADR', 'equity', 'core_growth', 'semiconductors', 'tsm', 'quarterly', 1,
    'Permanent semiconductor core — concentrated leading-edge manufacturing exposure.'),
  meta('CCJ', 'Cameco Corp.', 'equity', 'core_growth', 'uranium', 'ccj', 'annual'),
  meta('SMH', 'VanEck Semiconductor ETF', 'etf', 'core_growth', 'semiconductors', 'semis_basket', 'annual', 1,
    'Permanent semiconductor core — diversified basket across major semiconductor companies.'),

  // ── Semiconductor research universe (not owned by default) ────────────────
  meta('ASML', 'ASML Holding N.V. ADR', 'equity', 'core_growth', 'semi_equipment', 'asml', 'quarterly'),
  meta('QCOM', 'QUALCOMM Inc.', 'equity', 'core_growth', 'semiconductors', 'qcom', 'quarterly'),
  meta('TXN', 'Texas Instruments Inc.', 'equity', 'core_growth', 'semiconductors', 'txn', 'quarterly'),
  meta('GFS', 'GlobalFoundries Inc.', 'equity', 'core_growth', 'semiconductors', 'gfs', 'irregular'),
  meta('FTXL', 'First Trust Nasdaq Semiconductor ETF', 'etf', 'core_growth', 'semiconductors', 'semis_basket', 'quarterly'),
  meta('MU', 'Micron Technology Inc.', 'equity', 'core_growth', 'memory', 'mu', 'quarterly'),
  meta('AMD', 'Advanced Micro Devices Inc.', 'equity', 'core_growth', 'semiconductors', 'amd', 'irregular'),
  meta('MRVL', 'Marvell Technology Inc.', 'equity', 'core_growth', 'semiconductors', 'mrvl', 'quarterly'),
  meta('NVDA', 'NVIDIA Corp.', 'equity', 'core_growth', 'semiconductors', 'nvda', 'quarterly'),
  meta('SEMI', 'Columbia Seligman Semiconductor & Technology ETF', 'etf', 'core_growth', 'semiconductors', 'semis_basket', 'quarterly'),

  // ── Tactical leveraged sleeve ─────────────────────────────────────────────
  meta('TSMX', 'Leveraged ~2x TSM Daily ETP', 'etp', 'tactical_leveraged', 'semiconductors', 'tsm', 'irregular', 2,
    'Approximately 2x DAILY TSM exposure. Daily reset — not a 2x long-term return vehicle. Volatility decay applies.'),
  meta('SOXL', 'Direxion Daily Semiconductor Bull 3X Shares', 'etp', 'tactical_leveraged', 'semiconductors', 'semis_basket', 'quarterly', 3,
    'Approximately 3x DAILY semiconductor index exposure. Daily reset — not a 3x long-term return vehicle.'),

  // ── Shipping / cyclical ───────────────────────────────────────────────────
  meta('DAC', 'Danaos Corp.', 'equity', 'shipping_cyclical', 'containership_leasing', 'dac', 'quarterly'),
  meta('INSW', 'International Seaways Inc.', 'equity', 'shipping_cyclical', 'tankers', 'insw', 'quarterly'),
  meta('GSL', 'Global Ship Lease Inc.', 'equity', 'shipping_cyclical', 'containership_leasing', 'gsl', 'quarterly'),
  meta('CMBT', 'CMB.TECH NV', 'equity', 'shipping_cyclical', 'tankers', 'cmbt', 'quarterly'),

  // ── REIT / dividend core ──────────────────────────────────────────────────
  meta('O', 'Realty Income Corp.', 'reit', 'reit_dividend', 'net_lease_reit', 'o', 'monthly'),
  meta('STAG', 'STAG Industrial Inc.', 'reit', 'reit_dividend', 'industrial_reit', 'stag', 'monthly'),
  meta('VNQ', 'Vanguard Real Estate ETF', 'etf', 'reit_dividend', 'reit_basket', 'reit_basket', 'quarterly'),
  meta('SCHD', 'Schwab U.S. Dividend Equity ETF', 'etf', 'reit_dividend', 'dividend_equity', 'schd', 'quarterly'),
];

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

export function getInstrument(symbol: string): InstrumentMeta | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

/** Metadata for an unknown ticker so the app degrades gracefully. */
export function getInstrumentOrFallback(symbol: string): InstrumentMeta {
  const upper = symbol.toUpperCase();
  return (
    BY_SYMBOL.get(upper) ??
    meta(upper, upper, 'equity', 'unclassified', 'unknown', upper.toLowerCase(), 'irregular', 1,
      'Unknown instrument — classify in Settings before allocating capital to it.')
  );
}

export function symbolsInSleeve(sleeve: Sleeve): string[] {
  return INSTRUMENTS.filter((i) => i.sleeve === sleeve).map((i) => i.symbol);
}

/** Every leveraged instrument the risk engine must police. */
export const LEVERAGED_SYMBOLS = INSTRUMENTS.filter((i) => i.leverage > 1).map((i) => i.symbol);

/** Candidate income instruments the opportunity ranker scores. */
export const INCOME_UNIVERSE = symbolsInSleeve('income_engine');

/** Watchlists as specified by the investor. Ownership is NOT implied. */
export const WATCHLISTS = {
  robinhoodPrimary: ['NVDY', 'GOOGL', 'AMZN', 'WMT', 'TSM', 'CCJ', 'SMH', 'SOXL', 'TSMX'],
  semiconductorResearch: ['ASML', 'QCOM', 'TXN', 'GFS', 'FTXL', 'MU', 'AMD', 'MRVL', 'NVDA', 'SMH', 'TSM', 'SEMI'],
  shippingCyclical: ['DAC', 'INSW', 'GSL', 'CMBT'],
  reitDividend: ['O', 'STAG', 'VNQ', 'SCHD'],
  incomeAlternatives: ['NVDY', 'YMAG', 'YMAX', 'AMZY', 'MSFO', 'CHPY', 'TSMY', 'QQQI', 'SPYI', 'JEPQ'],
} as const;

export const SLEEVE_LABELS: Record<Sleeve, string> = {
  income_engine: 'Income Engine',
  core_growth: 'Core Growth',
  shipping_cyclical: 'Shipping / Cyclical',
  reit_dividend: 'REIT / Dividend Core',
  tactical_leveraged: 'Tactical Leveraged',
  cash: 'Cash',
  future_education: 'Future Education',
  unclassified: 'Unclassified',
};

/** Fixed display order so sleeve tables never reshuffle between renders. */
export const SLEEVE_ORDER: Sleeve[] = [
  'income_engine',
  'core_growth',
  'tactical_leveraged',
  'shipping_cyclical',
  'reit_dividend',
  'future_education',
  'cash',
  'unclassified',
];
