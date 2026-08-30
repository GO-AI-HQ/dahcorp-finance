import type {
  IntelligenceEvent,
  IntelligenceProviderStatus,
  ReferenceRegistry,
  SecurityReference,
} from '../../src/intelligence/types.js';
import {
  classifyEvent,
  ENERGY_INTELLIGENCE_SYMBOLS,
  sectorForText,
  SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
  SHIPPING_INTELLIGENCE_SYMBOLS,
  TECHNOLOGY_INTELLIGENCE_SYMBOLS,
  symbolsForText,
} from '../../src/intelligence/taxonomy.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const PROFILE_ANCHORS = ['AMD', 'CCJ', 'INSW', 'GOOGL'];

interface FinnhubNewsItem {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

interface FinnhubCapitalItem {
  symbol?: string;
  name?: string;
  transactionDate?: string;
  filingDate?: string;
  transaction?: string;
  amount?: number;
  ownerName?: string;
  representative?: string;
  description?: string;
  [key: string]: unknown;
}

interface FinnhubSymbolRow {
  symbol?: string;
  displaySymbol?: string;
  description?: string;
  type?: string;
  mic?: string;
  figi?: string;
  currency?: string;
}

interface FinnhubProfile {
  ticker?: string;
  name?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
  weburl?: string;
}

interface FinnhubEarningsRow {
  date?: string;
  symbol?: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  hour?: string | null;
  quarter?: number | null;
  year?: number | null;
}

interface FinnhubEarningsPayload {
  earningsCalendar?: FinnhubEarningsRow[];
}

function apiKey(): string | null {
  return Netlify.env.get('FINNHUB_API_KEY')?.trim() || null;
}

function strategySymbols(): string[] {
  return [...new Set([
    ...SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
    ...ENERGY_INTELLIGENCE_SYMBOLS,
    ...SHIPPING_INTELLIGENCE_SYMBOLS,
    ...TECHNOLOGY_INTELLIGENCE_SYMBOLS,
    'NVDY', 'YMAG', 'YMAX',
  ].map((symbol) => symbol.toUpperCase()))];
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const key = apiKey();
  if (!key) return { ok: false, status: 0, data: null };
  const query = new URLSearchParams({ ...params, token: key });
  const response = await fetch(`${FINNHUB_BASE}${path}?${query.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return { ok: false, status: response.status, data: null };
  try {
    return { ok: true, status: response.status, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: response.status, data: null };
  }
}

function isoFromUnix(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

async function normalizeNews(item: FinnhubNewsItem, sourceClass: 'market_news' | 'corporate'): Promise<IntelligenceEvent | null> {
  const headline = item.headline?.trim();
  if (!headline) return null;
  const summary = item.summary?.trim() || '';
  const text = `${headline} ${summary} ${item.related ?? ''}`;
  const symbols = [...new Set([
    ...symbolsForText(text),
    ...(item.related ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  ])];
  const sector = sectorForText(text, symbols);
  const classified = classifyEvent(text, sector);
  const occurredAt = isoFromUnix(item.datetime);
  return {
    fingerprint: await fingerprint(['finnhub-news', String(item.id ?? ''), occurredAt, headline]),
    occurredAt,
    discoveredAt: new Date().toISOString(),
    source: item.source?.trim() || 'Finnhub',
    sourceClass,
    sourceUrl: item.url?.trim() || null,
    sourceQuality: sourceClass === 'corporate' ? 0.72 : 0.62,
    sector,
    eventType: classified.eventType === 'OTHER' ? 'MARKET_NEWS' : classified.eventType,
    headline,
    summary,
    symbols,
    latency: 'near_real_time',
    direction: classified.direction,
    severity: classified.severity,
    sentimentScore: null,
    metadata: { category: item.category ?? null },
  };
}

function dateDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateDaysAgo(days: number): string {
  return dateDaysFromNow(-days);
}

async function companyNews(symbol: string): Promise<IntelligenceEvent[]> {
  const result = await getJson<FinnhubNewsItem[]>('/company-news', { symbol, from: dateDaysAgo(4), to: dateDaysFromNow(0) });
  if (!result.ok || !Array.isArray(result.data)) return [];
  const rows = await Promise.all(result.data.slice(0, 12).map((item) => normalizeNews(item, 'corporate')));
  return rows.filter((row): row is IntelligenceEvent => row !== null);
}

async function capitalEvents(path: string, symbol: string, label: string): Promise<IntelligenceEvent[]> {
  const result = await getJson<{ data?: FinnhubCapitalItem[] } | FinnhubCapitalItem[]>(path, { symbol });
  if (!result.ok || !result.data) return [];
  const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.data.data) ? result.data.data : [];
  const events: IntelligenceEvent[] = [];
  for (const raw of rows.slice(0, 8)) {
    const transactionDate = String(raw.transactionDate ?? raw.filingDate ?? new Date().toISOString()).slice(0, 10);
    const filingDate = String(raw.filingDate ?? '').slice(0, 10);
    const description = String(raw.description ?? raw.transaction ?? raw.name ?? raw.ownerName ?? raw.representative ?? label).trim();
    const headline = `${label}: ${symbol}${description && description !== label ? ` — ${description}` : ''}`;
    const text = `${headline} ${JSON.stringify(raw)}`;
    const sector = sectorForText(text, [symbol]);
    events.push({
      fingerprint: await fingerprint(['finnhub-capital', path, symbol, transactionDate, filingDate, description]),
      occurredAt: `${transactionDate}T12:00:00.000Z`,
      discoveredAt: new Date().toISOString(),
      source: 'Finnhub public-disclosure data',
      sourceClass: path.includes('lobbying') ? 'policy_proxy' : 'capital_signal',
      sourceUrl: null,
      sourceQuality: path.includes('congressional') ? 0.78 : 0.7,
      sector,
      eventType: 'CAPITAL_DISCLOSURE',
      headline,
      summary: filingDate ? `Reported/filing date: ${filingDate}. Transaction/event date: ${transactionDate}.` : `Transaction/event date: ${transactionDate}.`,
      symbols: [symbol],
      latency: path.includes('congressional') ? 'delayed_disclosure' : 'retrospective',
      direction: /purchase|buy|increase|long/i.test(text) ? 'constructive' : /sale|sell|decrease/i.test(text) ? 'restrictive' : 'unknown',
      severity: 'info',
      sentimentScore: null,
      metadata: { filingDate: filingDate || null, transactionDate, disclosureClass: label },
    });
  }
  return events;
}

async function referenceRegistry(): Promise<{ registry: ReferenceRegistry; ok: boolean; status: number }> {
  const symbols = strategySymbols();
  const directory = await getJson<FinnhubSymbolRow[]>('/stock/symbol', { exchange: 'US' });
  const profiles = await Promise.all(PROFILE_ANCHORS.map(async (symbol) => ({
    symbol,
    result: await getJson<FinnhubProfile>('/stock/profile2', { symbol }),
  })));
  const profileMap = new Map(profiles.filter((row) => row.result.ok && row.result.data).map((row) => [row.symbol, row.result.data as FinnhubProfile]));
  const directoryMap = new Map(
    (directory.ok && Array.isArray(directory.data) ? directory.data : [])
      .filter((row) => row.symbol)
      .map((row) => [String(row.symbol).toUpperCase(), row]),
  );
  const entries: SecurityReference[] = symbols.map((symbol) => {
    const row = directoryMap.get(symbol);
    const profile = profileMap.get(symbol);
    return {
      symbol,
      displaySymbol: row?.displaySymbol ?? null,
      name: profile?.name ?? row?.description ?? null,
      type: row?.type ?? null,
      currency: row?.currency ?? null,
      mic: row?.mic ?? null,
      figi: row?.figi ?? null,
      industry: profile?.finnhubIndustry ?? null,
      marketCapitalization: typeof profile?.marketCapitalization === 'number' ? profile.marketCapitalization : null,
      weburl: profile?.weburl ?? null,
      source: 'finnhub',
    };
  });
  return {
    registry: {
      asOf: new Date().toISOString(),
      exchange: 'US',
      symbols: entries,
      source: 'finnhub',
      note: 'Finnhub is the reference-data registry. Registry inclusion never expands the deterministic trading allowlist.',
    },
    ok: directory.ok,
    status: directory.status,
  };
}

async function earningsEvents(): Promise<{ events: IntelligenceEvent[]; ok: boolean; status: number }> {
  const result = await getJson<FinnhubEarningsPayload>('/calendar/earnings', {
    from: dateDaysAgo(1),
    to: dateDaysFromNow(14),
  });
  if (!result.ok || !Array.isArray(result.data?.earningsCalendar)) return { events: [], ok: false, status: result.status };
  const relevant = new Set(strategySymbols());
  const rows = result.data.earningsCalendar.filter((row) => row.symbol && relevant.has(row.symbol.toUpperCase())).slice(0, 60);
  const events = await Promise.all(rows.map(async (row): Promise<IntelligenceEvent> => {
    const symbol = String(row.symbol).toUpperCase();
    const date = String(row.date ?? dateDaysFromNow(0)).slice(0, 10);
    return {
      fingerprint: await fingerprint(['finnhub-earnings', symbol, date, String(row.quarter ?? ''), String(row.year ?? '')]),
      occurredAt: `${date}T12:00:00.000Z`,
      discoveredAt: new Date().toISOString(),
      source: 'Finnhub earnings calendar',
      sourceClass: 'corporate',
      sourceUrl: null,
      sourceQuality: 0.82,
      sector: sectorForText(symbol, [symbol]),
      eventType: 'EARNINGS_CALENDAR_EVENT',
      headline: `${symbol} earnings calendar event`,
      summary: `Scheduled ${date}${row.hour ? ` (${row.hour})` : ''}. EPS estimate=${row.epsEstimate ?? 'UNKNOWN'}, revenue estimate=${row.revenueEstimate ?? 'UNKNOWN'}. Actuals remain UNKNOWN until reported.`,
      symbols: [symbol],
      latency: 'near_real_time',
      direction: 'unknown',
      severity: 'medium',
      sentimentScore: null,
      metadata: {
        date,
        hour: row.hour ?? null,
        quarter: row.quarter ?? null,
        year: row.year ?? null,
        epsEstimate: row.epsEstimate ?? null,
        epsActual: row.epsActual ?? null,
        revenueEstimate: row.revenueEstimate ?? null,
        revenueActual: row.revenueActual ?? null,
      },
    };
  }));
  return { events, ok: true, status: result.status };
}

const EMPTY_REGISTRY: ReferenceRegistry = {
  asOf: new Date(0).toISOString(),
  exchange: 'US',
  symbols: [],
  source: 'finnhub',
  note: 'Finnhub reference data is unavailable; no synthetic security metadata is substituted.',
};

export async function fetchFinnhubIntelligence(): Promise<{
  events: IntelligenceEvent[];
  referenceRegistry: ReferenceRegistry;
  status: IntelligenceProviderStatus;
}> {
  if (!apiKey()) {
    return {
      events: [],
      referenceRegistry: { ...EMPTY_REGISTRY, asOf: new Date().toISOString() },
      status: { provider: 'finnhub', connected: false, status: 'not_configured', note: 'FINNHUB_API_KEY is not configured.' },
    };
  }

  const market = await getJson<FinnhubNewsItem[]>('/news', { category: 'general' });
  const marketRows = market.ok && Array.isArray(market.data)
    ? (await Promise.all(market.data.slice(0, 30).map((item) => normalizeNews(item, 'market_news')))).filter((row): row is IntelligenceEvent => row !== null)
    : [];

  const [
    amdNews, ccjNews, inswNews, googlNews,
    amdCongress, ccjCongress, inswCongress, googlCongress,
    amdLobbying, ccjLobbying, inswLobbying, googlLobbying,
    references, earnings,
  ] = await Promise.all([
    companyNews('AMD'), companyNews('CCJ'), companyNews('INSW'), companyNews('GOOGL'),
    capitalEvents('/stock/congressional-trading', 'AMD', 'Congressional disclosure'),
    capitalEvents('/stock/congressional-trading', 'CCJ', 'Congressional disclosure'),
    capitalEvents('/stock/congressional-trading', 'INSW', 'Congressional disclosure'),
    capitalEvents('/stock/congressional-trading', 'GOOGL', 'Congressional disclosure'),
    capitalEvents('/stock/lobbying', 'AMD', 'Lobbying disclosure'),
    capitalEvents('/stock/lobbying', 'CCJ', 'Lobbying disclosure'),
    capitalEvents('/stock/lobbying', 'INSW', 'Lobbying disclosure'),
    capitalEvents('/stock/lobbying', 'GOOGL', 'Lobbying disclosure'),
    referenceRegistry(),
    earningsEvents(),
  ]);

  const relevant = new Set(strategySymbols());
  const events = [
    ...marketRows,
    ...amdNews, ...ccjNews, ...inswNews, ...googlNews,
    ...amdCongress, ...ccjCongress, ...inswCongress, ...googlCongress,
    ...amdLobbying, ...ccjLobbying, ...inswLobbying, ...googlLobbying,
    ...earnings.events,
  ].filter((event) => event.sector !== 'cross_market' || event.symbols.some((symbol) => relevant.has(symbol)));

  const partial = !market.ok || !references.ok || !earnings.ok;
  const missing: string[] = [];
  if (!market.ok) missing.push(`news HTTP ${market.status || 'n/a'}`);
  if (!references.ok) missing.push(`symbol registry HTTP ${references.status || 'n/a'}`);
  if (!earnings.ok) missing.push(`earnings calendar HTTP ${earnings.status || 'n/a'}`);
  return {
    events,
    referenceRegistry: references.registry,
    status: {
      provider: 'finnhub',
      connected: true,
      status: partial ? 'partial' : 'live',
      note: partial
        ? `Finnhub is connected with graceful plan-aware degradation (${missing.join('; ')}). Available reference/company/event evidence remains live; unavailable fields remain UNKNOWN.`
        : 'Finnhub is live as the US security reference registry and company-event intelligence layer, including company news, earnings calendar and supported public-disclosure feeds.',
    },
  };
}
