import type {
  IntelligenceEvent,
  IntelligenceProviderStatus,
  IntelligenceSector,
  MarketBenchmarkLeg,
  MarketPulseTickerItem,
} from '../../src/intelligence/types.js';
import { marketPulseDirection, marketPulseNarrative, marketPulseState } from '../../src/intelligence/marketPulse.js';

const BASE = 'https://api.tradingeconomics.com';

type Sector = Exclude<IntelligenceSector, 'cross_market'>;

interface BenchmarkConcept {
  sector: Sector;
  name: string;
  search: string;
  expected: string;
}

const CONCEPTS: BenchmarkConcept[] = [
  { sector: 'shipping', name: 'BDI', search: 'baltic', expected: 'baltic:com' },
  { sector: 'semiconductors', name: 'SOX', search: 'sox', expected: 'sox:ind' },
  { sector: 'energy', name: 'WTI', search: 'wti', expected: 'cl1:com' },
  { sector: 'energy', name: 'Brent', search: 'brent', expected: 'co1:com' },
  { sector: 'technology', name: 'NDX', search: 'ndx', expected: 'ndx:ind' },
];

interface SearchRow { Symbol?: string; Name?: string; Country?: string; Category?: string }
interface QuoteRow {
  Symbol?: string;
  Name?: string;
  Date?: string;
  LastUpdate?: string;
  Last?: number;
  Close?: number;
  WeeklyPercentualChange?: number;
  MonthlyPercentualChange?: number;
}

const symbolCache = new Map<string, string>();

function apiKey(): string | null {
  const raw = Netlify.env.get('TRADINGECONOMICS_API_KEY')
    || Netlify.env.get('TRADING_ECONOMICS_API_KEY')
    || Netlify.env.get('TE_API_KEY');
  if (!raw) return null;
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return value || null;
}

function numeric(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function resolveSymbol(concept: BenchmarkConcept, key: string): Promise<string> {
  const cached = symbolCache.get(concept.search);
  if (cached) return cached;
  try {
    const response = await fetch(`${BASE}/markets/search/${encodeURIComponent(concept.search)}?c=${encodeURIComponent(key)}&f=json`, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const rows = await response.json() as SearchRow[];
      if (Array.isArray(rows) && rows.length) {
        const exact = rows.find((row) => String(row.Symbol ?? '').toLowerCase() === concept.expected.toLowerCase());
        const symbol = String(exact?.Symbol ?? rows[0]?.Symbol ?? '').trim();
        if (symbol) {
          symbolCache.set(concept.search, symbol);
          return symbol;
        }
      }
    }
  } catch {
    // Known symbol remains a safe fallback; the quote request is the final validation.
  }
  symbolCache.set(concept.search, concept.expected);
  return concept.expected;
}

async function fetchLeg(concept: BenchmarkConcept, key: string): Promise<MarketBenchmarkLeg | null> {
  const symbol = await resolveSymbol(concept, key);
  const response = await fetch(`${BASE}/markets/symbol/${encodeURIComponent(symbol)}?c=${encodeURIComponent(key)}&f=json`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const rows = await response.json() as QuoteRow[];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return {
    name: concept.name,
    symbol: String(row.Symbol ?? symbol),
    provider: 'tradingeconomics',
    last: numeric(row.Last ?? row.Close),
    return5d: numeric(row.WeeklyPercentualChange),
    return30d: numeric(row.MonthlyPercentualChange),
    asOf: String(row.LastUpdate ?? row.Date ?? new Date().toISOString()),
  };
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function eventForPulse(item: MarketPulseTickerItem): Promise<IntelligenceEvent | null> {
  if (item.dataRole !== 'primary' || !item.benchmarks.length) return null;
  const return5d = average(item.benchmarks.map((leg) => leg.return5d));
  const return30d = average(item.benchmarks.map((leg) => leg.return30d));
  const asOf = item.benchmarks.map((leg) => leg.asOf).sort().at(-1) ?? new Date().toISOString();
  const benchmark = item.benchmarks.map((leg) => leg.name).join(' + ');
  return {
    fingerprint: await fingerprint(['tradingeconomics', item.sector, benchmark, asOf.slice(0, 10), item.state]),
    occurredAt: asOf,
    discoveredAt: new Date().toISOString(),
    source: 'TradingEconomics market benchmarks',
    sourceClass: 'market_benchmark',
    sourceUrl: null,
    sourceQuality: 0.9,
    sector: item.sector,
    eventType: 'MARKET_BENCHMARK_TREND',
    headline: `${benchmark} market pulse is ${item.state.toLowerCase()}`,
    summary: item.summary,
    symbols: item.benchmarks.map((leg) => leg.symbol),
    latency: 'near_real_time',
    direction: marketPulseDirection(item.state),
    severity: item.state === 'Defensive' || item.state === 'Improving' ? 'medium' : 'low',
    sentimentScore: return5d == null && return30d == null ? null : Math.max(-1, Math.min(1, ((return5d ?? 0) / 10 + (return30d ?? 0) / 20) / 2)),
    metadata: { return5d, return30d, state: item.state, role: 'primary_macro_benchmark' },
  };
}

export async function fetchTradingEconomicsMarketPulse(): Promise<{
  marketPulse: MarketPulseTickerItem[];
  events: IntelligenceEvent[];
  status: IntelligenceProviderStatus;
}> {
  const key = apiKey();
  if (!key) {
    return {
      marketPulse: [],
      events: [],
      status: {
        provider: 'tradingeconomics',
        connected: false,
        status: 'not_configured',
        note: 'TradingEconomics Market Pulse is ready; configure TRADINGECONOMICS_API_KEY to activate BDI, SOX, WTI/Brent and NDX benchmarks.',
      },
    };
  }

  const resolved = await Promise.all(CONCEPTS.map(async (concept) => ({ concept, leg: await fetchLeg(concept, key).catch(() => null) })));
  const sectors: Sector[] = ['shipping', 'semiconductors', 'energy', 'technology'];
  const marketPulse: MarketPulseTickerItem[] = sectors.map((sector) => {
    const benchmarks = resolved.filter((row) => row.concept.sector === sector && row.leg).map((row) => row.leg as MarketBenchmarkLeg);
    const return5d = average(benchmarks.map((leg) => leg.return5d));
    const return30d = average(benchmarks.map((leg) => leg.return30d));
    const state = marketPulseState(return5d, return30d);
    return {
      sector,
      state,
      benchmarks,
      confirmation: null,
      dataRole: benchmarks.length ? 'primary' : 'unavailable',
      summary: marketPulseNarrative(sector, state),
    };
  });
  const events = (await Promise.all(marketPulse.map(eventForPulse))).filter((event): event is IntelligenceEvent => Boolean(event));
  const failures = resolved.filter((row) => !row.leg).length;
  return {
    marketPulse,
    events,
    status: {
      provider: 'tradingeconomics',
      connected: true,
      status: failures ? 'partial' : 'live',
      note: failures
        ? `TradingEconomics is connected; ${failures} of ${CONCEPTS.length} benchmark probes were unavailable. Available primary benchmarks remain usable.`
        : 'TradingEconomics is live for BDI, SOX, WTI, Brent and NDX with weekly/monthly benchmark movement.',
    },
  };
}
