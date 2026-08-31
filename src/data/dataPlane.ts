export type DataPlaneDomain =
  | 'portfolio'
  | 'market'
  | 'income'
  | 'intelligence'
  | 'strategy'
  | 'strategy_basis';

export type DataPlaneRequirement =
  | 'broker_accounts'
  | 'current_quotes'
  | 'price_history'
  | 'macro_benchmarks'
  | 'distribution_history'
  | 'realized_income'
  | 'earnings_calendar'
  | 'company_market_news'
  | 'security_reference'
  | 'government_lobbying_disclosures'
  | 'options_positioning'
  | 'short_interest_crowding'
  | 'company_filings_insider'
  | 'fund_holdings_lookthrough'
  | 'energy_supply_positioning'
  | 'shipping_ports'
  | 'savings_rate_benchmark';

export type DataPlaneProviderId =
  | 'schwab'
  | 'robinhood'
  | 'broker_realized'
  | 'openbb'
  | 'finnhub'
  | 'fmp'
  | 'fred'
  | 'rateapi'
  | 'sec'
  | 'finra'
  | 'eia'
  | 'cftc'
  | 'imf_portwatch'
  | 'manual';

export interface FreshnessPolicy {
  /** Evidence is considered current for this long after it was observed. */
  freshForMs: number;
  /** Evidence may still render, visibly aged, until this age. */
  staleUsableForMs: number;
}

export interface ProviderRoute {
  requirement: DataPlaneRequirement;
  domain: DataPlaneDomain;
  primary: readonly DataPlaneProviderId[];
  secondary: readonly DataPlaneProviderId[];
  freshness: FreshnessPolicy;
  /** Whether a last verified snapshot may render when live providers fail. */
  allowLastKnownGood: boolean;
  note: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Provider priority is requirement-specific. No provider is globally "best";
 * the route reflects authority, freshness, quota/cost, and the evidence class.
 * Secondary providers are corroboration/fallbacks, never permission to invent
 * evidence when the primary source is unavailable.
 */
export const PROVIDER_ROUTES: Readonly<Record<DataPlaneRequirement, ProviderRoute>> = {
  broker_accounts: {
    requirement: 'broker_accounts',
    domain: 'portfolio',
    primary: ['schwab', 'robinhood'],
    secondary: [],
    freshness: { freshForMs: 15 * MINUTE, staleUsableForMs: 6 * HOUR },
    allowLastKnownGood: true,
    note: 'The connected brokerage is authoritative for account, cash, quantity and ownership state.',
  },
  current_quotes: {
    requirement: 'current_quotes',
    domain: 'market',
    primary: ['schwab'],
    secondary: ['openbb', 'finnhub'],
    freshness: { freshForMs: 15 * MINUTE, staleUsableForMs: 18 * HOUR },
    allowLastKnownGood: true,
    note: 'Retained quotes may support UI continuity but are never execution prices.',
  },
  price_history: {
    requirement: 'price_history',
    domain: 'market',
    primary: ['openbb'],
    secondary: ['finnhub'],
    freshness: { freshForMs: 12 * HOUR, staleUsableForMs: 72 * HOUR },
    allowLastKnownGood: true,
    note: 'Historical bars drive trend and Market Pulse calculations; page views should not refetch them.',
  },
  macro_benchmarks: {
    requirement: 'macro_benchmarks',
    domain: 'market',
    primary: ['fred', 'openbb'],
    secondary: [],
    freshness: { freshForMs: 6 * HOUR, staleUsableForMs: 72 * HOUR },
    allowLastKnownGood: true,
    note: 'Macro evidence is persisted independently from route-health diagnostics.',
  },
  distribution_history: {
    requirement: 'distribution_history',
    domain: 'income',
    primary: ['fmp'],
    secondary: ['openbb'],
    freshness: { freshForMs: DAY, staleUsableForMs: 7 * DAY },
    allowLastKnownGood: true,
    note: 'FMP remains scheduled/cache-only and is constrained by the hard daily request budget.',
  },
  realized_income: {
    requirement: 'realized_income',
    domain: 'income',
    primary: ['broker_realized'],
    secondary: ['manual'],
    freshness: { freshForMs: 12 * HOUR, staleUsableForMs: 7 * DAY },
    allowLastKnownGood: true,
    note: 'Actual broker-observed cash received outranks inferred distribution schedules.',
  },
  earnings_calendar: {
    requirement: 'earnings_calendar',
    domain: 'intelligence',
    primary: ['finnhub'],
    secondary: ['openbb'],
    freshness: { freshForMs: HOUR, staleUsableForMs: DAY },
    allowLastKnownGood: true,
    note: 'Finnhub earnings events are persisted; event count is independent of V3 lane coverage.',
  },
  company_market_news: {
    requirement: 'company_market_news',
    domain: 'intelligence',
    primary: ['finnhub'],
    secondary: ['openbb'],
    freshness: { freshForMs: 30 * MINUTE, staleUsableForMs: 6 * HOUR },
    allowLastKnownGood: true,
    note: 'News is background-refreshed and normalized before it reaches strategy or model context.',
  },
  security_reference: {
    requirement: 'security_reference',
    domain: 'intelligence',
    primary: ['finnhub'],
    secondary: ['schwab', 'openbb'],
    freshness: { freshForMs: 7 * DAY, staleUsableForMs: 30 * DAY },
    allowLastKnownGood: true,
    note: 'Reference-data inclusion never expands the deterministic trading allowlist.',
  },
  government_lobbying_disclosures: {
    requirement: 'government_lobbying_disclosures',
    domain: 'intelligence',
    primary: ['finnhub'],
    secondary: ['sec', 'openbb'],
    freshness: { freshForMs: 6 * HOUR, staleUsableForMs: 72 * HOUR },
    allowLastKnownGood: true,
    note: 'Finnhub already supplies congressional/lobbying disclosure evidence for tracked anchors.',
  },
  options_positioning: {
    requirement: 'options_positioning',
    domain: 'intelligence',
    primary: ['openbb'],
    secondary: [],
    freshness: { freshForMs: 30 * MINUTE, staleUsableForMs: 6 * HOUR },
    allowLastKnownGood: true,
    note: 'A working OpenBB V3 route must be reconciled into the persisted options lane.',
  },
  short_interest_crowding: {
    requirement: 'short_interest_crowding',
    domain: 'intelligence',
    primary: ['finra', 'openbb'],
    secondary: [],
    freshness: { freshForMs: DAY, staleUsableForMs: 7 * DAY },
    allowLastKnownGood: true,
    note: 'Publication cadence is slower than quotes; stale-but-usable evidence remains visibly aged.',
  },
  company_filings_insider: {
    requirement: 'company_filings_insider',
    domain: 'intelligence',
    primary: ['sec', 'openbb'],
    secondary: ['finnhub'],
    freshness: { freshForMs: 6 * HOUR, staleUsableForMs: 48 * HOUR },
    allowLastKnownGood: true,
    note: 'Finnhub may corroborate disclosure/insider evidence but SEC-origin evidence remains authoritative where available.',
  },
  fund_holdings_lookthrough: {
    requirement: 'fund_holdings_lookthrough',
    domain: 'intelligence',
    primary: ['sec', 'openbb'],
    secondary: [],
    freshness: { freshForMs: DAY, staleUsableForMs: 14 * DAY },
    allowLastKnownGood: true,
    note: 'N-PORT/fund holdings should refresh with publication cadence, not page views.',
  },
  energy_supply_positioning: {
    requirement: 'energy_supply_positioning',
    domain: 'intelligence',
    primary: ['eia', 'cftc', 'openbb'],
    secondary: [],
    freshness: { freshForMs: 6 * HOUR, staleUsableForMs: 72 * HOUR },
    allowLastKnownGood: true,
    note: 'Supply and positioning evidence are separate sources normalized into one energy lane.',
  },
  shipping_ports: {
    requirement: 'shipping_ports',
    domain: 'intelligence',
    primary: ['imf_portwatch', 'openbb'],
    secondary: [],
    freshness: { freshForMs: 6 * HOUR, staleUsableForMs: 72 * HOUR },
    allowLastKnownGood: true,
    note: 'Shipping/port evidence follows publication cadence and persists independently of UI access.',
  },
  savings_rate_benchmark: {
    requirement: 'savings_rate_benchmark',
    domain: 'market',
    primary: ['rateapi'],
    secondary: [],
    freshness: { freshForMs: 3 * DAY, staleUsableForMs: 10 * DAY },
    allowLastKnownGood: true,
    note: 'RateAPI is low-frequency benchmark evidence and must never be a page-load dependency.',
  },
};

export type SnapshotFreshness = 'fresh' | 'stale_usable' | 'expired' | 'invalid';

export interface SnapshotSource {
  providers: DataPlaneProviderId[];
  primaryProvider: DataPlaneProviderId | null;
  mode: 'live' | 'composed' | 'retained';
}

export interface SnapshotQuality {
  usable: boolean;
  containsMockData: boolean;
  notes: string[];
}

export interface DataPlaneSnapshot<T = unknown> {
  schemaVersion: 1;
  domain: DataPlaneDomain;
  capturedAt: string;
  /** Time the underlying evidence was observed by its provider(s). */
  observedAt: string;
  source: SnapshotSource;
  freshnessPolicy: FreshnessPolicy;
  quality: SnapshotQuality;
  payload: T;
}

export function routeFor(requirement: DataPlaneRequirement): ProviderRoute {
  return PROVIDER_ROUTES[requirement];
}

export function classifySnapshotFreshness(
  observedAt: string,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): SnapshotFreshness {
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return 'invalid';
  const ageMs = Math.max(0, now.getTime() - observedMs);
  if (ageMs <= policy.freshForMs) return 'fresh';
  if (ageMs <= policy.staleUsableForMs) return 'stale_usable';
  return 'expired';
}

export function snapshotAgeMs(snapshot: Pick<DataPlaneSnapshot, 'observedAt'>, now: Date = new Date()): number | null {
  const observedMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedMs)) return null;
  return Math.max(0, now.getTime() - observedMs);
}

export function isSnapshotUsable(snapshot: DataPlaneSnapshot, now: Date = new Date()): boolean {
  if (!snapshot.quality.usable) return false;
  const freshness = classifySnapshotFreshness(snapshot.observedAt, snapshot.freshnessPolicy, now);
  return freshness === 'fresh' || freshness === 'stale_usable';
}

export function createDataPlaneSnapshot<T>(args: {
  domain: DataPlaneDomain;
  observedAt: string;
  providers: DataPlaneProviderId[];
  primaryProvider?: DataPlaneProviderId | null;
  mode?: SnapshotSource['mode'];
  freshnessPolicy: FreshnessPolicy;
  payload: T;
  containsMockData?: boolean;
  usable?: boolean;
  notes?: string[];
  capturedAt?: string;
}): DataPlaneSnapshot<T> {
  return {
    schemaVersion: 1,
    domain: args.domain,
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    observedAt: args.observedAt,
    source: {
      providers: [...new Set(args.providers)],
      primaryProvider: args.primaryProvider ?? args.providers[0] ?? null,
      mode: args.mode ?? (args.providers.length > 1 ? 'composed' : 'live'),
    },
    freshnessPolicy: args.freshnessPolicy,
    quality: {
      usable: args.usable ?? true,
      containsMockData: args.containsMockData ?? false,
      notes: [...new Set(args.notes ?? [])],
    },
    payload: args.payload,
  };
}
