import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { SignedOpenBBGatewayClient, type OpenBBEnvelope } from './openbbGatewayClient.mts';
import { persistIntelligenceEvents, recentIntelligenceEvents } from './intelligenceStore.mts';

type LaneName =
  | 'options'
  | 'fund_lookthrough'
  | 'maritime'
  | 'energy_positioning'
  | 'filings_insiders'
  | 'earnings'
  | 'crowding'
  | 'government_capital';

type LaneState = 'live' | 'partial' | 'unavailable';

export interface EvidenceLaneStatus {
  lane: LaneName;
  status: LaneState;
  sources: string[];
  itemCount: number;
  asOf: string | null;
  caveats: string[];
}

export interface OptionsEvidence {
  symbol: string;
  underlyingPrice: number | null;
  contractsObserved: number;
  totalOpenInterest: number | null;
  totalVolume: number | null;
  putCallOpenInterestRatio: number | null;
  medianImpliedVolatility: number | null;
  medianBidAskSpreadPct: number | null;
  medianDte: number | null;
}

export interface FundPositionEvidence {
  key: string;
  name: string | null;
  cusip: string | null;
  value: number | null;
  percentOfFund: number | null;
}

export interface FundLookThroughEvidence {
  symbol: string;
  disclosedPositionCount: number;
  topPositions: FundPositionEvidence[];
}

export interface FundOverlapEvidence {
  left: string;
  right: string;
  sharedPositionCount: number;
  weightedOverlapPct: number | null;
}

export interface MaritimeFlowEvidence {
  chokepoint: string;
  asOf: string | null;
  latestVessels: number | null;
  average7dVessels: number | null;
  average30dVessels: number | null;
  sevenVsThirtyPct: number | null;
  latestTankers: number | null;
  latestContainers: number | null;
  signal: 'material_drop' | 'surge' | 'normal_range' | 'unknown';
}

export interface PortFlowEvidence {
  country: string;
  asOf: string | null;
  portCalls: number | null;
  tankerCalls: number | null;
  containerCalls: number | null;
}

export interface EarningsEvidence {
  symbol: string;
  quarters: number;
  averageSurprisePct: number | null;
  positiveSurpriseCount: number;
  latestPeriod: string | null;
  latestSurprisePct: number | null;
}

export interface FilingEvidence {
  symbol: string;
  periodEnding: string | null;
  calendarPeriod: string | null;
  filingUrl: string | null;
  mdnaExcerpt: string | null;
}

export interface InsiderEvidence {
  symbol: string;
  purchaseCount: number;
  saleCount: number;
  latestTransactionDate: string | null;
  transactions: Array<Record<string, string | number | null>>;
}

export interface CrowdingEvidence {
  symbol: string;
  settlementDate: string | null;
  shortInterest: number | null;
  daysToCover: number | null;
  averageDailyVolume: number | null;
}

export interface GovernmentCapitalEvidence {
  symbol: string | null;
  headline: string;
  occurredAt: string;
  discoveredAt: string;
  latency: string;
  filingDate: string | null;
  transactionDate: string | null;
  direction: string;
}

export interface AdvancedEvidenceFabric {
  version: 'v3';
  asOf: string;
  lanes: Record<LaneName, EvidenceLaneStatus>;
  options: OptionsEvidence[];
  fundLookThrough: FundLookThroughEvidence[];
  fundOverlap: FundOverlapEvidence[];
  maritime: {
    chokepoints: MaritimeFlowEvidence[];
    ports: PortFlowEvidence[];
  };
  energy: {
    petroleum: Array<Record<string, string | number | boolean | null>>;
    shortTermOutlook: Array<Record<string, string | number | boolean | null>>;
    cftc: Array<{ query: string; code: string | null; rows: Array<Record<string, string | number | boolean | null>> }>;
  };
  company: {
    filings: FilingEvidence[];
    insiders: InsiderEvidence[];
  };
  earnings: EarningsEvidence[];
  crowding: CrowdingEvidence[];
  governmentCapital: GovernmentCapitalEvidence[];
  fusion: {
    coveragePct: number;
    liveLaneCount: number;
    partialLaneCount: number;
    unavailableLaneCount: number;
    contradictions: string[];
    note: string;
  };
}

interface OptionRow {
  underlying_price?: unknown;
  dte?: unknown;
  option_type?: unknown;
  open_interest?: unknown;
  volume?: unknown;
  implied_volatility?: unknown;
  bid?: unknown;
  ask?: unknown;
  mark?: unknown;
}

interface NportRow extends Record<string, unknown> {
  symbol?: unknown;
  name?: unknown;
  title?: unknown;
  cusip?: unknown;
  value?: unknown;
  value_usd?: unknown;
  percent_of_fund?: unknown;
  percent_of_net_assets?: unknown;
  pct_value?: unknown;
}

interface MaritimeRow extends Record<string, unknown> {
  date?: unknown;
  chokepoint?: unknown;
  vessels_total?: unknown;
  vessels_tanker?: unknown;
  vessels_container?: unknown;
}

interface PortRow extends Record<string, unknown> {
  date?: unknown;
  country?: unknown;
  country_code?: unknown;
  portcalls?: unknown;
  portcalls_tanker?: unknown;
  portcalls_container?: unknown;
}

interface FinnhubEarningsRow {
  actual?: unknown;
  estimate?: unknown;
  period?: unknown;
  surprise?: unknown;
  surprisePercent?: unknown;
  symbol?: unknown;
}

type SimpleRecord = Record<string, string | number | boolean | null>;

const OPTIONS_SYMBOLS = ['NVDA', 'AMD', 'TSM', 'SMH', 'SOXL', 'AMZN', 'GOOGL', 'CCJ'];
const FUND_SYMBOLS = ['NVDY', 'YMAG', 'YMAX', 'SMH', 'SOXL', 'QQQI', 'JEPQ', 'SPYI'];
const COMPANY_SYMBOLS = ['AMD', 'NVDA', 'GOOGL', 'AMZN', 'WMT', 'INSW', 'CCJ', 'TSM'];
const MDNA_SYMBOLS = ['AMD', 'NVDA', 'GOOGL', 'AMZN', 'WMT', 'INSW'];
const PORT_COUNTRIES = ['USA', 'SGP', 'NLD', 'CHN'];
const CFTC_QUERIES = ['crude oil', 'nasdaq'];
const GATEWAY_SOURCE = 'DAHCorp Intelligence Fabric v3';

function envValue(key: string): string | undefined {
  try {
    const value = Netlify.env.get(key);
    if (value != null) return value;
  } catch {
    // Unit-test/local runtimes may not expose Netlify.env.
  }
  return process.env[key];
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function pctChange(current: number | null, prior: number | null): number | null {
  return current != null && prior != null && prior !== 0 ? ((current / prior) - 1) * 100 : null;
}

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function simpleRecord(value: unknown, maxKeys = 14): SimpleRecord {
  if (!value || typeof value !== 'object') return {};
  const out: SimpleRecord = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, maxKeys)) {
    if (raw == null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') out[key] = raw as SimpleRecord[string];
  }
  return out;
}

function lane(laneName: LaneName, sources: string[], itemCount: number, failures: number, caveats: string[]): EvidenceLaneStatus {
  const status: LaneState = itemCount > 0 ? (failures > 0 ? 'partial' : 'live') : 'unavailable';
  return {
    lane: laneName,
    status,
    sources,
    itemCount,
    asOf: itemCount ? new Date().toISOString() : null,
    caveats,
  };
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function summarizeOptions(symbol: string, rows: OptionRow[]): OptionsEvidence | null {
  const usable = rows.filter((row) => {
    const dte = numberValue(row.dte);
    return dte == null || (dte >= 7 && dte <= 75);
  });
  if (!usable.length) return null;
  const calls = usable.filter((row) => String(row.option_type ?? '').toLowerCase().startsWith('c'));
  const puts = usable.filter((row) => String(row.option_type ?? '').toLowerCase().startsWith('p'));
  const callOi = calls.reduce((sum, row) => sum + (numberValue(row.open_interest) ?? 0), 0);
  const putOi = puts.reduce((sum, row) => sum + (numberValue(row.open_interest) ?? 0), 0);
  const totalOi = callOi + putOi;
  const totalVolume = usable.reduce((sum, row) => sum + (numberValue(row.volume) ?? 0), 0);
  const ivs = usable.map((row) => numberValue(row.implied_volatility)).filter((value): value is number => value != null && value >= 0);
  const dtes = usable.map((row) => numberValue(row.dte)).filter((value): value is number => value != null && value >= 0);
  const spreads = usable.map((row) => {
    const bid = numberValue(row.bid);
    const ask = numberValue(row.ask);
    const mark = numberValue(row.mark) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
    return bid != null && ask != null && mark != null && mark > 0 && ask >= bid ? ((ask - bid) / mark) * 100 : null;
  }).filter((value): value is number => value != null && Number.isFinite(value));
  const underlying = usable.map((row) => numberValue(row.underlying_price)).find((value) => value != null) ?? null;
  return {
    symbol,
    underlyingPrice: underlying,
    contractsObserved: usable.length,
    totalOpenInterest: totalOi || null,
    totalVolume: totalVolume || null,
    putCallOpenInterestRatio: callOi > 0 ? putOi / callOi : null,
    medianImpliedVolatility: median(ivs),
    medianBidAskSpreadPct: median(spreads),
    medianDte: median(dtes),
  };
}

function fundKey(row: NportRow): string {
  return stringValue(row.cusip)?.toUpperCase()
    || stringValue(row.symbol)?.toUpperCase()
    || stringValue(row.name)?.toUpperCase()
    || stringValue(row.title)?.toUpperCase()
    || '';
}

function normalizeFund(symbol: string, rows: NportRow[]): FundLookThroughEvidence | null {
  if (!rows.length) return null;
  const positions = rows.map((row) => {
    const key = fundKey(row);
    const pctRaw = numberValue(row.percent_of_fund ?? row.percent_of_net_assets ?? row.pct_value);
    return {
      key,
      name: stringValue(row.name ?? row.title),
      cusip: stringValue(row.cusip),
      value: numberValue(row.value_usd ?? row.value),
      percentOfFund: pctRaw,
    } satisfies FundPositionEvidence;
  }).filter((row) => row.key);
  if (!positions.length) return null;
  const topPositions = [...positions]
    .sort((a, b) => (b.percentOfFund ?? 0) - (a.percentOfFund ?? 0) || (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 30);
  return { symbol, disclosedPositionCount: positions.length, topPositions };
}

function fundOverlaps(funds: FundLookThroughEvidence[]): FundOverlapEvidence[] {
  const out: FundOverlapEvidence[] = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const left = funds[i];
      const right = funds[j];
      const rightMap = new Map(right.topPositions.map((row) => [row.key, row]));
      const shared = left.topPositions.filter((row) => rightMap.has(row.key));
      const weighted = shared.map((row) => {
        const other = rightMap.get(row.key);
        return row.percentOfFund != null && other?.percentOfFund != null ? Math.min(row.percentOfFund, other.percentOfFund) : null;
      }).filter((value): value is number => value != null);
      out.push({
        left: left.symbol,
        right: right.symbol,
        sharedPositionCount: shared.length,
        weightedOverlapPct: weighted.length ? weighted.reduce((sum, value) => sum + value, 0) : null,
      });
    }
  }
  return out.sort((a, b) => (b.weightedOverlapPct ?? b.sharedPositionCount) - (a.weightedOverlapPct ?? a.sharedPositionCount)).slice(0, 20);
}

function maritimeSummary(rows: MaritimeRow[]): MaritimeFlowEvidence[] {
  const groups = new Map<string, MaritimeRow[]>();
  for (const row of rows) {
    const key = stringValue(row.chokepoint);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: MaritimeFlowEvidence[] = [];
  for (const [chokepoint, values] of groups) {
    const sorted = [...values].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
    const latest = sorted.at(-1);
    const last30 = sorted.slice(-30);
    const last7 = sorted.slice(-7);
    const avg7 = average(last7.map((row) => numberValue(row.vessels_total)));
    const avg30 = average(last30.map((row) => numberValue(row.vessels_total)));
    const change = pctChange(avg7, avg30);
    out.push({
      chokepoint,
      asOf: stringValue(latest?.date),
      latestVessels: numberValue(latest?.vessels_total),
      average7dVessels: avg7,
      average30dVessels: avg30,
      sevenVsThirtyPct: change,
      latestTankers: numberValue(latest?.vessels_tanker),
      latestContainers: numberValue(latest?.vessels_container),
      signal: change == null ? 'unknown' : change <= -20 ? 'material_drop' : change >= 20 ? 'surge' : 'normal_range',
    });
  }
  return out.sort((a, b) => Math.abs(b.sevenVsThirtyPct ?? 0) - Math.abs(a.sevenVsThirtyPct ?? 0));
}

function portSummary(country: string, rows: PortRow[]): PortFlowEvidence | null {
  if (!rows.length) return null;
  const latestDate = rows.map((row) => stringValue(row.date)).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const latestRows = latestDate ? rows.filter((row) => stringValue(row.date) === latestDate) : rows.slice(-20);
  const sum = (key: keyof PortRow) => {
    const values = latestRows.map((row) => numberValue(row[key])).filter((value): value is number => value != null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    country,
    asOf: latestDate,
    portCalls: sum('portcalls'),
    tankerCalls: sum('portcalls_tanker'),
    containerCalls: sum('portcalls_container'),
  };
}

async function finnhubEarnings(symbol: string): Promise<EarningsEvidence | null> {
  const key = envValue('FINNHUB_API_KEY')?.trim();
  if (!key) return null;
  const query = new URLSearchParams({ symbol, limit: '4', token: key });
  const response = await fetch(`https://finnhub.io/api/v1/stock/earnings?${query.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const rows = await response.json() as FinnhubEarningsRow[];
  if (!Array.isArray(rows) || !rows.length) return null;
  const surprises = rows.map((row) => numberValue(row.surprisePercent)).filter((value): value is number => value != null);
  const latest = [...rows].sort((a, b) => String(b.period ?? '').localeCompare(String(a.period ?? '')))[0];
  return {
    symbol,
    quarters: rows.length,
    averageSurprisePct: average(surprises),
    positiveSurpriseCount: surprises.filter((value) => value > 0).length,
    latestPeriod: stringValue(latest?.period),
    latestSurprisePct: numberValue(latest?.surprisePercent),
  };
}

function cftcCode(payload: OpenBBEnvelope<Record<string, unknown>>): string | null {
  for (const row of payload.results ?? []) {
    for (const key of ['code', 'cftc_contract_market_code', 'contract_market_code', 'cftc_code']) {
      const value = stringValue(row[key]);
      if (value) return value;
    }
  }
  return null;
}

function mdnaEvidence(symbol: string, payload: OpenBBEnvelope<Record<string, unknown>>): FilingEvidence | null {
  const row = payload.results?.[0];
  if (!row) return null;
  const content = stringValue(row.content);
  return {
    symbol,
    periodEnding: stringValue(row.period_ending),
    calendarPeriod: stringValue(row.calendar_period),
    filingUrl: stringValue(row.url),
    mdnaExcerpt: content ? content.slice(0, 3500) : null,
  };
}

function insiderEvidence(symbol: string, payload: OpenBBEnvelope<Record<string, unknown>>): InsiderEvidence | null {
  const rows = payload.results ?? [];
  if (!rows.length) return null;
  let purchases = 0;
  let sales = 0;
  const transactions = rows.slice(0, 16).map((row) => {
    const type = String(row.transaction_type ?? row.acquisition_or_disposition ?? '').toLowerCase();
    if (/purchase|acquisition|buy/.test(type)) purchases += 1;
    if (/sale|disposition|sell/.test(type)) sales += 1;
    return {
      transactionDate: stringValue(row.transaction_date),
      filingDate: stringValue(row.filing_date),
      ownerName: stringValue(row.owner_name),
      ownerTitle: stringValue(row.owner_title),
      transactionType: stringValue(row.transaction_type),
      acquisitionOrDisposition: stringValue(row.acquisition_or_disposition),
      securitiesTransacted: numberValue(row.securities_transacted ?? row.securities_owned),
      transactionPrice: numberValue(row.transaction_price),
    } as Record<string, string | number | null>;
  });
  const latestTransactionDate = transactions.map((row) => row.transactionDate).filter((value): value is string => typeof value === 'string').sort().at(-1) ?? null;
  return { symbol, purchaseCount: purchases, saleCount: sales, latestTransactionDate, transactions };
}

function crowdingEvidence(symbol: string, payload: OpenBBEnvelope<Record<string, unknown>>): CrowdingEvidence | null {
  const rows = payload.results ?? [];
  if (!rows.length) return null;
  const latest = [...rows].sort((a, b) => String(b.settlement_date ?? '').localeCompare(String(a.settlement_date ?? '')))[0];
  return {
    symbol,
    settlementDate: stringValue(latest.settlement_date),
    shortInterest: numberValue(latest.short_interest ?? latest.short_interest_quantity),
    daysToCover: numberValue(latest.days_to_cover),
    averageDailyVolume: numberValue(latest.average_daily_volume ?? latest.avg_daily_volume),
  };
}

function governmentCapitalFromEvents(events: IntelligenceEvent[]): GovernmentCapitalEvidence[] {
  return events
    .filter((event) => event.eventType === 'CAPITAL_DISCLOSURE' || event.sourceClass === 'capital_signal' || event.sourceClass === 'policy_proxy')
    .slice(0, 30)
    .map((event) => ({
      symbol: event.symbols[0] ?? null,
      headline: event.headline,
      occurredAt: event.occurredAt,
      discoveredAt: event.discoveredAt,
      latency: event.latency,
      filingDate: stringValue(event.metadata?.filingDate),
      transactionDate: stringValue(event.metadata?.transactionDate),
      direction: event.direction,
    }));
}

function contradictions(options: OptionsEvidence[], earnings: EarningsEvidence[], insiders: InsiderEvidence[], government: GovernmentCapitalEvidence[]): string[] {
  const out: string[] = [];
  for (const earning of earnings) {
    const option = options.find((row) => row.symbol === earning.symbol);
    if (earning.averageSurprisePct != null && option?.putCallOpenInterestRatio != null) {
      if (earning.averageSurprisePct >= 5 && option.putCallOpenInterestRatio >= 1.3) {
        out.push(`${earning.symbol}: positive recent earnings surprises coexist with defensive put/call open-interest positioning.`);
      } else if (earning.averageSurprisePct <= -5 && option.putCallOpenInterestRatio <= 0.8) {
        out.push(`${earning.symbol}: weak recent earnings surprises coexist with relatively call-heavy options positioning.`);
      }
    }
  }
  for (const row of insiders) {
    if (row.purchaseCount > 0 && row.saleCount > 0) out.push(`${row.symbol}: recent SEC insider filings contain both acquisitions and dispositions; insider evidence is mixed.`);
  }
  const bySymbol = new Map<string, Set<string>>();
  for (const row of government) {
    if (!row.symbol) continue;
    const set = bySymbol.get(row.symbol) ?? new Set<string>();
    set.add(row.direction);
    bySymbol.set(row.symbol, set);
  }
  for (const [symbol, directions] of bySymbol) {
    if (directions.has('constructive') && directions.has('restrictive')) out.push(`${symbol}: government/capital disclosures contain opposing directional signals and remain latency-sensitive.`);
  }
  return [...new Set(out)].slice(0, 20);
}

function emptyLane(name: LaneName, sources: string[], caveats: string[]): EvidenceLaneStatus {
  return lane(name, sources, 0, 1, caveats);
}

export function emptyAdvancedEvidenceFabric(): AdvancedEvidenceFabric {
  const asOf = new Date().toISOString();
  const lanes = {
    options: emptyLane('options', ['OpenBB/yfinance'], ['Options evidence is unavailable; no synthetic chain is substituted.']),
    fund_lookthrough: emptyLane('fund_lookthrough', ['SEC N-PORT via OpenBB'], ['Fund look-through is unavailable; overlap remains UNKNOWN.']),
    maritime: emptyLane('maritime', ['IMF PortWatch via OpenBB'], ['Physical shipping-flow evidence is unavailable.']),
    energy_positioning: emptyLane('energy_positioning', ['EIA via OpenBB', 'CFTC via OpenBB'], ['Energy inventory/positioning evidence is unavailable.']),
    filings_insiders: emptyLane('filings_insiders', ['SEC via OpenBB'], ['SEC filing/insider evidence is unavailable.']),
    earnings: emptyLane('earnings', ['Finnhub'], ['Earnings surprise evidence is unavailable.']),
    crowding: emptyLane('crowding', ['FINRA via OpenBB'], ['Short-interest/crowding evidence is unavailable.']),
    government_capital: emptyLane('government_capital', ['Finnhub/AInvest/public disclosures'], ['Government/capital disclosures are unavailable or outside the retained window.']),
  } satisfies Record<LaneName, EvidenceLaneStatus>;
  return {
    version: 'v3', asOf, lanes,
    options: [], fundLookThrough: [], fundOverlap: [],
    maritime: { chokepoints: [], ports: [] },
    energy: { petroleum: [], shortTermOutlook: [], cftc: [] },
    company: { filings: [], insiders: [] },
    earnings: [], crowding: [], governmentCapital: [],
    fusion: {
      coveragePct: 0, liveLaneCount: 0, partialLaneCount: 0, unavailableLaneCount: 8, contradictions: [],
      note: 'No v3 production evidence snapshot is available. Missing evidence remains UNKNOWN and is never replaced with fixtures.',
    },
  };
}

export async function fetchAdvancedEvidenceFabric(): Promise<AdvancedEvidenceFabric> {
  const gateway = new SignedOpenBBGatewayClient();
  const priorEvents = await recentIntelligenceEvents(220);

  let optionFailures = 0;
  const options = gateway.isConfigured() ? (await Promise.all(OPTIONS_SYMBOLS.map(async (symbol) => {
    try {
      const payload = await gateway.get<OpenBBEnvelope<OptionRow>>('/v3/options/chains', new URLSearchParams({ symbol }));
      return summarizeOptions(symbol, payload.results ?? []);
    } catch { optionFailures += 1; return null; }
  }))).filter((row): row is OptionsEvidence => row != null) : [];
  if (!gateway.isConfigured()) optionFailures = OPTIONS_SYMBOLS.length;

  let fundFailures = 0;
  const funds = gateway.isConfigured() ? (await Promise.all(FUND_SYMBOLS.map(async (symbol) => {
    try {
      const payload = await gateway.get<OpenBBEnvelope<NportRow>>('/v3/fund/nport', new URLSearchParams({ symbol }));
      return normalizeFund(symbol, payload.results ?? []);
    } catch { fundFailures += 1; return null; }
  }))).filter((row): row is FundLookThroughEvidence => row != null) : [];
  if (!gateway.isConfigured()) fundFailures = FUND_SYMBOLS.length;

  let maritimeFailures = 0;
  let chokepoints: MaritimeFlowEvidence[] = [];
  const ports: PortFlowEvidence[] = [];
  if (gateway.isConfigured()) {
    try {
      const payload = await gateway.get<OpenBBEnvelope<MaritimeRow>>('/v3/shipping/chokepoints', new URLSearchParams({ start_date: dateDaysAgo(45), end_date: today() }));
      chokepoints = maritimeSummary(payload.results ?? []);
    } catch { maritimeFailures += 1; }
    const portRows = await Promise.all(PORT_COUNTRIES.map(async (country) => {
      try {
        const payload = await gateway.get<OpenBBEnvelope<PortRow>>('/v3/shipping/ports', new URLSearchParams({ country, start_date: dateDaysAgo(14), end_date: today() }));
        return portSummary(country, payload.results ?? []);
      } catch { maritimeFailures += 1; return null; }
    }));
    ports.push(...portRows.filter((row): row is PortFlowEvidence => row != null));
  } else maritimeFailures = 1 + PORT_COUNTRIES.length;

  let energyFailures = 0;
  let petroleum: SimpleRecord[] = [];
  let steo: SimpleRecord[] = [];
  const cftc: Array<{ query: string; code: string | null; rows: SimpleRecord[] }> = [];
  if (gateway.isConfigured()) {
    try {
      const payload = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/energy/petroleum', new URLSearchParams({ category: 'weekly_estimates', start_date: dateDaysAgo(120), end_date: today() }));
      petroleum = (payload.results ?? []).slice(-40).map((row) => simpleRecord(row));
    } catch { energyFailures += 1; }
    try {
      const payload = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/energy/steo', new URLSearchParams({ table: '01' }));
      steo = (payload.results ?? []).slice(-30).map((row) => simpleRecord(row));
    } catch { energyFailures += 1; }
    for (const query of CFTC_QUERIES) {
      try {
        const search = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/cftc/search', new URLSearchParams({ query }));
        const code = cftcCode(search);
        if (!code) { energyFailures += 1; cftc.push({ query, code: null, rows: [] }); continue; }
        const report = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/cftc/cot', new URLSearchParams({ code, limit: '4' }));
        cftc.push({ query, code, rows: (report.results ?? []).slice(0, 8).map((row) => simpleRecord(row, 18)) });
      } catch { energyFailures += 1; cftc.push({ query, code: null, rows: [] }); }
    }
  } else energyFailures = 2 + CFTC_QUERIES.length;

  let filingFailures = 0;
  const filings: FilingEvidence[] = [];
  const insiders: InsiderEvidence[] = [];
  if (gateway.isConfigured()) {
    const filingRows = await Promise.all(MDNA_SYMBOLS.map(async (symbol) => {
      try {
        const payload = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/sec/mdna', new URLSearchParams({ symbol }));
        return mdnaEvidence(symbol, payload);
      } catch { filingFailures += 1; return null; }
    }));
    filings.push(...filingRows.filter((row): row is FilingEvidence => row != null));
    const insiderRows = await Promise.all(COMPANY_SYMBOLS.map(async (symbol) => {
      try {
        const payload = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/sec/insiders', new URLSearchParams({ symbol, limit: '40' }));
        return insiderEvidence(symbol, payload);
      } catch { filingFailures += 1; return null; }
    }));
    insiders.push(...insiderRows.filter((row): row is InsiderEvidence => row != null));
  } else filingFailures = MDNA_SYMBOLS.length + COMPANY_SYMBOLS.length;

  let earningsFailures = 0;
  const earnings = (await Promise.all(COMPANY_SYMBOLS.map(async (symbol) => {
    try {
      const row = await finnhubEarnings(symbol);
      if (!row) earningsFailures += 1;
      return row;
    } catch { earningsFailures += 1; return null; }
  }))).filter((row): row is EarningsEvidence => row != null);

  let crowdingFailures = 0;
  const crowding = gateway.isConfigured() ? (await Promise.all(COMPANY_SYMBOLS.map(async (symbol) => {
    try {
      const payload = await gateway.get<OpenBBEnvelope<Record<string, unknown>>>('/v3/short-interest', new URLSearchParams({ symbol }));
      const row = crowdingEvidence(symbol, payload);
      if (!row) crowdingFailures += 1;
      return row;
    } catch { crowdingFailures += 1; return null; }
  }))).filter((row): row is CrowdingEvidence => row != null) : [];
  if (!gateway.isConfigured()) crowdingFailures = COMPANY_SYMBOLS.length;

  const governmentCapital = governmentCapitalFromEvents(priorEvents);
  const governmentFailures = governmentCapital.length ? 0 : 1;

  const lanes = {
    options: lane('options', ['OpenBB/yfinance options chains'], options.length, optionFailures, ['Options chains are market evidence, not a forecast. Wide spreads and low open interest reduce confidence.']),
    fund_lookthrough: lane('fund_lookthrough', ['SEC N-PORT via OpenBB'], funds.length, fundFailures, ['N-PORT is periodic disclosure and can lag current fund composition. Missing fund weights remain UNKNOWN.']),
    maritime: lane('maritime', ['IMF PortWatch via OpenBB'], chokepoints.length + ports.length, maritimeFailures, ['AIS/PortWatch vessel and capacity estimates are physical-economy evidence and may be revised.']),
    energy_positioning: lane('energy_positioning', ['EIA via OpenBB', 'CFTC via OpenBB'], petroleum.length + steo.length + cftc.reduce((sum, row) => sum + row.rows.length, 0), energyFailures, ['EIA and CFTC series have publication schedules; unavailable provider credentials/extensions are reported as missing, never mocked.']),
    filings_insiders: lane('filings_insiders', ['SEC via OpenBB'], filings.length + insiders.length, filingFailures, ['MD&A text is issuer-authored disclosure. Insider filings can include grants, gifts and planned sales that require context.']),
    earnings: lane('earnings', ['Finnhub company earnings'], earnings.length, earningsFailures, ['Finnhub free-tier surprise history can be limited to the most recent quarters.']),
    crowding: lane('crowding', ['FINRA short interest via OpenBB'], crowding.length, crowdingFailures, ['FINRA short interest is periodic and not real-time borrow utilization.']),
    government_capital: lane('government_capital', ['Finnhub/AInvest/public-disclosure ledger'], governmentCapital.length, governmentFailures, ['Government trading disclosures are delayed and are corroborating evidence only, never a standalone trade trigger.']),
  } satisfies Record<LaneName, EvidenceLaneStatus>;

  const statuses = Object.values(lanes);
  const liveLaneCount = statuses.filter((row) => row.status === 'live').length;
  const partialLaneCount = statuses.filter((row) => row.status === 'partial').length;
  const unavailableLaneCount = statuses.filter((row) => row.status === 'unavailable').length;
  const covered = liveLaneCount + partialLaneCount * 0.5;
  const contradictionList = contradictions(options, earnings, insiders, governmentCapital);
  const asOf = new Date().toISOString();

  return {
    version: 'v3',
    asOf,
    lanes,
    options,
    fundLookThrough: funds,
    fundOverlap: fundOverlaps(funds),
    maritime: { chokepoints, ports },
    energy: { petroleum, shortTermOutlook: steo, cftc },
    company: { filings, insiders },
    earnings,
    crowding,
    governmentCapital,
    fusion: {
      coveragePct: Math.round((covered / 8) * 100),
      liveLaneCount,
      partialLaneCount,
      unavailableLaneCount,
      contradictions: contradictionList,
      note: 'Evidence Fusion v3 measures source coverage and surfaces cross-source contradictions. It does not convert heterogeneous evidence into an opaque trade score. Terra/Claude interpret the evidence; deterministic policy remains authoritative for eligibility, sizing, risk and execution.',
    },
  };
}

export async function refreshAdvancedEvidenceFabric(): Promise<{ fabric: AdvancedEvidenceFabric; persisted: number }> {
  const fabric = await fetchAdvancedEvidenceFabric();
  const event: IntelligenceEvent = {
    fingerprint: await fingerprint(['dahcorp-fabric-v3', fabric.asOf.slice(0, 13)]),
    occurredAt: fabric.asOf,
    discoveredAt: fabric.asOf,
    source: GATEWAY_SOURCE,
    sourceClass: 'openbb',
    sourceUrl: null,
    sourceQuality: 0.9,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `Intelligence Fabric v3 refreshed with ${fabric.fusion.coveragePct}% weighted lane coverage`,
    summary: `Eight evidence lanes: ${fabric.fusion.liveLaneCount} live, ${fabric.fusion.partialLaneCount} partial, ${fabric.fusion.unavailableLaneCount} unavailable. Missing lanes remain UNKNOWN.`,
    symbols: [...new Set([
      ...fabric.options.map((row) => row.symbol),
      ...fabric.fundLookThrough.map((row) => row.symbol),
      ...fabric.earnings.map((row) => row.symbol),
      ...fabric.crowding.map((row) => row.symbol),
    ])],
    latency: 'near_real_time',
    direction: 'neutral',
    severity: fabric.fusion.unavailableLaneCount >= 4 ? 'medium' : 'info',
    sentimentScore: null,
    metadata: { advancedEvidenceV3: fabric },
  };
  const persisted = await persistIntelligenceEvents([event]);
  return { fabric, persisted };
}

function isAdvancedEvidenceFabric(value: unknown): value is AdvancedEvidenceFabric {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AdvancedEvidenceFabric>;
  return row.version === 'v3' && typeof row.asOf === 'string' && Boolean(row.lanes) && Boolean(row.fusion);
}

export async function loadAdvancedEvidenceFabric(): Promise<AdvancedEvidenceFabric> {
  const events = await recentIntelligenceEvents(260);
  for (const event of events) {
    if (event.source !== GATEWAY_SOURCE) continue;
    const value = event.metadata?.advancedEvidenceV3;
    if (isAdvancedEvidenceFabric(value)) return value;
  }
  return emptyAdvancedEvidenceFabric();
}
