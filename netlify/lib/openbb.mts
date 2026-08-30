import type {
  EconomicCalendarItem,
  IntelligenceEvent,
  IntelligenceProviderStatus,
  IntelligenceSector,
  MacroRegimeSeries,
  MacroRegimeSnapshot,
  MarketBenchmarkLeg,
  MarketPulseTickerItem,
} from '../../src/intelligence/types.js';
import { marketPulseDirection, marketPulseNarrative, marketPulseState } from '../../src/intelligence/marketPulse.js';
import { SignedOpenBBGatewayClient, type OpenBBEnvelope } from './openbbGatewayClient.mts';

type Sector = Exclude<IntelligenceSector, 'cross_market'>;
type HistoryKind = 'equity' | 'index';

interface BenchmarkConcept {
  sector: Sector;
  name: string;
  symbol: string;
  kind: HistoryKind;
}

const BENCHMARKS: BenchmarkConcept[] = [
  { sector: 'shipping', name: 'BDRY', symbol: 'BDRY', kind: 'equity' },
  { sector: 'semiconductors', name: 'SOX', symbol: '^SOX', kind: 'index' },
  { sector: 'energy', name: 'WTI', symbol: 'CL=F', kind: 'equity' },
  { sector: 'energy', name: 'Brent', symbol: 'BZ=F', kind: 'equity' },
  { sector: 'technology', name: 'NDX', symbol: '^NDX', kind: 'index' },
];

const PROFILE_ANCHORS = ['AMD', 'CCJ', 'INSW', 'GOOGL'];
const FRED_SERIES = [
  'FEDFUNDS', 'DGS2', 'DGS10', 'T10Y2Y', 'CPIAUCSL', 'PCEPI', 'UNRATE',
  'PAYEMS', 'INDPRO', 'RSAFS', 'VIXCLS', 'BAMLH0A0HYM2', 'NFCI', 'DTWEXBGS',
];

const FRED_LABELS: Record<string, string> = {
  FEDFUNDS: 'Federal funds rate',
  DGS2: '2-year Treasury yield',
  DGS10: '10-year Treasury yield',
  T10Y2Y: '10Y minus 2Y Treasury spread',
  CPIAUCSL: 'Consumer Price Index',
  PCEPI: 'PCE price index',
  UNRATE: 'Unemployment rate',
  PAYEMS: 'Nonfarm payrolls',
  INDPRO: 'Industrial production',
  RSAFS: 'Retail sales',
  VIXCLS: 'VIX',
  BAMLH0A0HYM2: 'US high-yield option-adjusted spread',
  NFCI: 'Chicago Fed National Financial Conditions Index',
  DTWEXBGS: 'Trade-weighted US dollar index',
};

interface HistoricalRow {
  date?: string;
  close?: number | null;
  adjusted_close?: number | null;
}

interface FredObservation {
  date?: string;
  value?: number | null;
}

interface FredSeriesResult {
  series?: string;
  observations?: FredObservation[];
}

interface FredPayload {
  provider?: string;
  results?: FredSeriesResult[];
}

interface CalendarRow {
  date?: string;
  event?: string;
  name?: string;
  country?: string;
  actual?: number | string | null;
  consensus?: number | string | null;
  previous?: number | string | null;
  importance?: string | number | null;
}

interface ProfileRow {
  symbol?: string;
  name?: string | null;
  industry?: string | null;
  sector?: string | null;
}

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  return isoDaysFromNow(-days);
}

function numeric(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function closeValue(row: HistoricalRow): number | null {
  return numeric(row.adjusted_close ?? row.close);
}

function pctChange(current: number, prior: number): number | null {
  return prior > 0 ? ((current / prior) - 1) * 100 : null;
}

function nearestPrior(rows: HistoricalRow[], targetTime: number): HistoricalRow | null {
  let best: HistoricalRow | null = null;
  let bestTime = -Infinity;
  for (const row of rows) {
    const time = Date.parse(String(row.date ?? ''));
    if (!Number.isFinite(time) || time > targetTime || time < bestTime || closeValue(row) == null) continue;
    best = row;
    bestTime = time;
  }
  return best;
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchBenchmark(client: SignedOpenBBGatewayClient, concept: BenchmarkConcept): Promise<MarketBenchmarkLeg | null> {
  const path = concept.kind === 'index' ? '/v2/index/history' : '/v1/history';
  const payload = await client.get<OpenBBEnvelope<HistoricalRow>>(path, new URLSearchParams({
    symbol: concept.symbol,
    start_date: isoDaysAgo(50),
    end_date: isoDaysFromNow(0),
    ...(concept.kind === 'equity' ? { provider: 'yfinance' } : {}),
  }));
  const rows = (payload.results ?? [])
    .filter((row) => closeValue(row) != null && typeof row.date === 'string')
    .sort((a, b) => Date.parse(String(a.date)) - Date.parse(String(b.date)));
  const latest = rows.at(-1);
  const current = latest ? closeValue(latest) : null;
  if (!latest || current == null) return null;
  const latestTime = Date.parse(String(latest.date));
  const fivePrior = nearestPrior(rows, latestTime - 7 * 86_400_000);
  const monthPrior = nearestPrior(rows, latestTime - 30 * 86_400_000);
  const five = fivePrior ? closeValue(fivePrior) : null;
  const month = monthPrior ? closeValue(monthPrior) : null;
  return {
    name: concept.name,
    symbol: concept.symbol,
    provider: 'openbb',
    last: current,
    return5d: five == null ? null : pctChange(current, five),
    return30d: month == null ? null : pctChange(current, month),
    asOf: new Date(String(latest.date)).toISOString(),
  };
}

async function eventForPulse(item: MarketPulseTickerItem): Promise<IntelligenceEvent | null> {
  if (item.dataRole !== 'primary' || !item.benchmarks.length) return null;
  const return5d = average(item.benchmarks.map((leg) => leg.return5d));
  const return30d = average(item.benchmarks.map((leg) => leg.return30d));
  const asOf = item.benchmarks.map((leg) => leg.asOf).sort().at(-1) ?? new Date().toISOString();
  const benchmark = item.benchmarks.map((leg) => leg.name).join(' + ');
  return {
    fingerprint: await fingerprint(['openbb-market-pulse', item.sector, benchmark, asOf.slice(0, 10), item.state]),
    occurredAt: asOf,
    discoveredAt: new Date().toISOString(),
    source: 'OpenBB market and index fabric',
    sourceClass: 'market_benchmark',
    sourceUrl: null,
    sourceQuality: 0.88,
    sector: item.sector,
    eventType: 'MARKET_BENCHMARK_TREND',
    headline: `${benchmark} market pulse is ${item.state.toLowerCase()}`,
    summary: item.summary,
    symbols: item.benchmarks.map((leg) => leg.symbol),
    latency: 'near_real_time',
    direction: marketPulseDirection(item.state),
    severity: item.state === 'Defensive' || item.state === 'Improving' ? 'medium' : 'low',
    sentimentScore: return5d == null && return30d == null ? null : Math.max(-1, Math.min(1, ((return5d ?? 0) / 10 + (return30d ?? 0) / 20) / 2)),
    metadata: { return5d, return30d, state: item.state, role: 'primary_market_benchmark', provider: 'openbb' },
  };
}

function latestAndPrior30(observations: FredObservation[]): { latest: number | null; prior30d: number | null; asOf: string | null } {
  const rows = observations
    .map((row) => ({ date: String(row.date ?? '').slice(0, 10), value: numeric(row.value) }))
    .filter((row): row is { date: string; value: number } => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.value != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows.at(-1);
  if (!latest) return { latest: null, prior30d: null, asOf: null };
  const target = Date.parse(`${latest.date}T00:00:00Z`) - 30 * 86_400_000;
  let prior: { date: string; value: number } | null = null;
  for (const row of rows) {
    if (Date.parse(`${row.date}T00:00:00Z`) <= target) prior = row;
  }
  return { latest: latest.value, prior30d: prior?.value ?? null, asOf: latest.date };
}

function regimeLabel(series: MacroRegimeSeries[]): MacroRegimeSnapshot['regime'] {
  const get = (id: string) => series.find((item) => item.series === id)?.latest ?? null;
  const vix = get('VIXCLS');
  const hy = get('BAMLH0A0HYM2');
  const nfci = get('NFCI');
  const curve = get('T10Y2Y');
  const usable = [vix, hy, nfci, curve].filter((value) => value != null).length;
  if (usable < 3) return 'insufficient_data';
  let stress = 0;
  if (vix != null && vix >= 25) stress += 1;
  if (hy != null && hy >= 5) stress += 1;
  if (nfci != null && nfci > 0.25) stress += 1;
  if (curve != null && curve < -0.25) stress += 1;
  if (stress >= 2) return 'risk_off';
  if ((vix == null || vix < 20) && (hy == null || hy < 4) && (nfci == null || nfci <= 0)) return 'risk_on';
  return 'balanced';
}

async function fetchMacroRegime(client: SignedOpenBBGatewayClient): Promise<MacroRegimeSnapshot> {
  const payload = await client.get<FredPayload>('/v2/fred/series', new URLSearchParams({
    series: FRED_SERIES.join(','),
    start_date: isoDaysAgo(420),
    end_date: isoDaysFromNow(0),
  }));
  const series: MacroRegimeSeries[] = (payload.results ?? []).map((row) => {
    const id = String(row.series ?? '').toUpperCase();
    const values = latestAndPrior30(row.observations ?? []);
    return {
      series: id,
      label: FRED_LABELS[id] ?? id,
      latest: values.latest,
      prior30d: values.prior30d,
      change30d: values.latest != null && values.prior30d != null ? values.latest - values.prior30d : null,
      asOf: values.asOf,
      source: 'fred' as const,
    };
  });
  const get = (id: string) => series.find((item) => item.series === id)?.latest ?? null;
  const regime = regimeLabel(series);
  return {
    asOf: new Date().toISOString(),
    series,
    yieldCurve10y2y: get('T10Y2Y'),
    vix: get('VIXCLS'),
    highYieldSpread: get('BAMLH0A0HYM2'),
    financialConditions: get('NFCI'),
    fedFunds: get('FEDFUNDS'),
    regime,
    note: 'Regime is a deterministic label derived from live FRED series. It is context, not a forecast or trade instruction.',
  };
}

async function macroRegimeEvent(snapshot: MacroRegimeSnapshot): Promise<IntelligenceEvent> {
  const direction = snapshot.regime === 'risk_on' ? 'constructive' : snapshot.regime === 'risk_off' ? 'restrictive' : snapshot.regime === 'balanced' ? 'neutral' : 'unknown';
  return {
    fingerprint: await fingerprint(['fred-regime', snapshot.asOf.slice(0, 13), snapshot.regime, String(snapshot.vix), String(snapshot.highYieldSpread)]),
    occurredAt: snapshot.asOf,
    discoveredAt: new Date().toISOString(),
    source: 'Federal Reserve Economic Data via DAHCorp gateway',
    sourceClass: 'market_benchmark',
    sourceUrl: null,
    sourceQuality: 0.96,
    sector: 'cross_market',
    eventType: 'MACRO_REGIME_UPDATE',
    headline: `Macro regime is ${snapshot.regime.replace('_', ' ')}`,
    summary: `VIX=${snapshot.vix ?? 'UNKNOWN'}, HY OAS=${snapshot.highYieldSpread ?? 'UNKNOWN'}, NFCI=${snapshot.financialConditions ?? 'UNKNOWN'}, 10Y-2Y=${snapshot.yieldCurve10y2y ?? 'UNKNOWN'}, Fed Funds=${snapshot.fedFunds ?? 'UNKNOWN'}.`,
    symbols: [],
    latency: 'near_real_time',
    direction,
    severity: snapshot.regime === 'risk_off' ? 'high' : 'low',
    sentimentScore: snapshot.regime === 'risk_on' ? 0.55 : snapshot.regime === 'risk_off' ? -0.7 : snapshot.regime === 'balanced' ? 0 : null,
    metadata: { ...snapshot, series: snapshot.series.map((row) => ({ series: row.series, latest: row.latest, change30d: row.change30d, asOf: row.asOf })) },
  };
}

async function fetchEconomicCalendar(client: SignedOpenBBGatewayClient): Promise<EconomicCalendarItem[]> {
  const payload = await client.get<OpenBBEnvelope<CalendarRow>>('/v2/macro/calendar', new URLSearchParams({
    start_date: isoDaysAgo(1),
    end_date: isoDaysFromNow(14),
  }));
  return (payload.results ?? []).slice(0, 80).map((row) => ({
    date: String(row.date ?? '').slice(0, 10),
    event: String(row.event ?? row.name ?? 'Economic release'),
    country: row.country ? String(row.country) : null,
    actual: row.actual ?? null,
    consensus: row.consensus ?? null,
    previous: row.previous ?? null,
    importance: row.importance == null ? null : String(row.importance),
    source: 'openbb' as const,
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

async function calendarEvents(items: EconomicCalendarItem[]): Promise<IntelligenceEvent[]> {
  return Promise.all(items.slice(0, 30).map(async (item) => ({
    fingerprint: await fingerprint(['openbb-calendar', item.date, item.event, item.country ?? '']),
    occurredAt: `${item.date}T12:00:00.000Z`,
    discoveredAt: new Date().toISOString(),
    source: 'OpenBB economic calendar',
    sourceClass: 'primary_source' as const,
    sourceUrl: null,
    sourceQuality: 0.9,
    sector: 'cross_market' as const,
    eventType: 'ECONOMIC_CALENDAR_EVENT' as const,
    headline: item.event,
    summary: `Scheduled economic release${item.country ? ` for ${item.country}` : ''}. Consensus=${item.consensus ?? 'UNKNOWN'}, previous=${item.previous ?? 'UNKNOWN'}, actual=${item.actual ?? 'UNKNOWN'}.`,
    symbols: [],
    latency: 'near_real_time' as const,
    direction: 'unknown' as const,
    severity: /fed|fomc|cpi|inflation|payroll|employment|gdp|pce/i.test(item.event) ? 'medium' as const : 'info' as const,
    sentimentScore: null,
    metadata: item as unknown as Record<string, unknown>,
  })));
}

async function profileCoverage(client: SignedOpenBBGatewayClient): Promise<number> {
  try {
    const payload = await client.get<OpenBBEnvelope<ProfileRow>>('/v2/profile', new URLSearchParams({ symbol: PROFILE_ANCHORS.join(',') }));
    return (payload.results ?? []).filter((row) => row.symbol).length;
  } catch {
    return 0;
  }
}

const EMPTY_MACRO: MacroRegimeSnapshot = {
  asOf: new Date(0).toISOString(),
  series: [],
  yieldCurve10y2y: null,
  vix: null,
  highYieldSpread: null,
  financialConditions: null,
  fedFunds: null,
  regime: 'insufficient_data',
  note: 'Macro regime data is unavailable; no synthetic values are substituted.',
};

export async function fetchOpenBBIntelligence(): Promise<{
  events: IntelligenceEvent[];
  marketPulse: MarketPulseTickerItem[];
  macroRegime: MacroRegimeSnapshot;
  economicCalendar: EconomicCalendarItem[];
  status: IntelligenceProviderStatus;
}> {
  const client = new SignedOpenBBGatewayClient();
  if (!client.isConfigured()) {
    return {
      events: [],
      marketPulse: [],
      macroRegime: { ...EMPTY_MACRO, asOf: new Date().toISOString() },
      economicCalendar: [],
      status: {
        provider: 'openbb',
        connected: false,
        status: 'not_configured',
        note: 'The signed OpenBB gateway is not configured. No synthetic macro or benchmark data is substituted.',
      },
    };
  }

  try {
    const benchmarkRows = await Promise.all(BENCHMARKS.map(async (concept) => ({ concept, leg: await fetchBenchmark(client, concept).catch(() => null) })));
    const sectors: Sector[] = ['shipping', 'semiconductors', 'energy', 'technology'];
    const marketPulse: MarketPulseTickerItem[] = sectors.map((sector) => {
      const benchmarks = benchmarkRows.filter((row) => row.concept.sector === sector && row.leg).map((row) => row.leg as MarketBenchmarkLeg);
      const state = marketPulseState(
        average(benchmarks.map((leg) => leg.return5d)),
        average(benchmarks.map((leg) => leg.return30d)),
      );
      return {
        sector,
        state,
        benchmarks,
        confirmation: null,
        dataRole: benchmarks.length ? 'primary' : 'unavailable',
        summary: marketPulseNarrative(sector, state),
      };
    });

    const [macroResult, calendarResult, profiles] = await Promise.all([
      fetchMacroRegime(client).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: { ...EMPTY_MACRO, asOf: new Date().toISOString() } })),
      fetchEconomicCalendar(client).then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const, value: [] as EconomicCalendarItem[] })),
      profileCoverage(client),
    ]);

    const pulseEvents = (await Promise.all(marketPulse.map(eventForPulse))).filter((event): event is IntelligenceEvent => Boolean(event));
    const events = [
      ...pulseEvents,
      ...(macroResult.ok ? [await macroRegimeEvent(macroResult.value)] : []),
      ...(calendarResult.ok ? await calendarEvents(calendarResult.value) : []),
    ];
    const benchmarkFailures = benchmarkRows.filter((row) => !row.leg).length;
    const partial = benchmarkFailures > 0 || !macroResult.ok || !calendarResult.ok || profiles < PROFILE_ANCHORS.length;

    return {
      events,
      marketPulse,
      macroRegime: macroResult.value,
      economicCalendar: calendarResult.value,
      status: {
        provider: 'openbb',
        connected: true,
        status: partial ? 'partial' : 'live',
        note: partial
          ? `OpenBB v2 is connected with ${BENCHMARKS.length - benchmarkFailures}/${BENCHMARKS.length} primary benchmarks, ${profiles}/${PROFILE_ANCHORS.length} profile anchors, macro=${macroResult.ok ? 'live' : 'unavailable'}, calendar=${calendarResult.ok ? 'live' : 'unavailable'}. Missing fields remain UNKNOWN.`
          : 'OpenBB v2 is live as the primary market/macro fabric: index and market regimes, FRED series, economic calendar and company profile confirmation are available.',
      },
    };
  } catch {
    return {
      events: [],
      marketPulse: [],
      macroRegime: { ...EMPTY_MACRO, asOf: new Date().toISOString() },
      economicCalendar: [],
      status: {
        provider: 'openbb',
        connected: false,
        status: 'unavailable',
        note: 'OpenBB v2 is configured but unreachable. Missing intelligence remains UNKNOWN; no mock replacement is used.',
      },
    };
  }
}
