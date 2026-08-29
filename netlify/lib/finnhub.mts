import type { IntelligenceEvent, IntelligenceProviderStatus } from '../../src/intelligence/types.js';
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

interface FinnhubNewsItem {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
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

function apiKey(): string | null {
  return Netlify.env.get('FINNHUB_API_KEY')?.trim() || null;
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

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function companyNews(symbol: string): Promise<IntelligenceEvent[]> {
  const result = await getJson<FinnhubNewsItem[]>('/company-news', { symbol, from: dateDaysAgo(4), to: new Date().toISOString().slice(0, 10) });
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

export async function fetchFinnhubIntelligence(): Promise<{ events: IntelligenceEvent[]; status: IntelligenceProviderStatus }> {
  if (!apiKey()) {
    return {
      events: [],
      status: { provider: 'finnhub', connected: false, status: 'not_configured', note: 'FINNHUB_API_KEY is not configured.' },
    };
  }

  const market = await getJson<FinnhubNewsItem[]>('/news', { category: 'general' });
  const marketRows = market.ok && Array.isArray(market.data)
    ? (await Promise.all(market.data.slice(0, 30).map((item) => normalizeNews(item, 'market_news')))).filter((row): row is IntelligenceEvent => row !== null)
    : [];

  // One anchor per active research lane keeps request volume disciplined while
  // the broader taxonomy maps sector spillovers downstream.
  const [
    amdNews, ccjNews, inswNews, googlNews,
    amdCongress, ccjCongress, inswCongress, googlCongress,
    amdLobbying, ccjLobbying, inswLobbying, googlLobbying,
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
  ]);

  const strategySymbols = [
    ...SEMICONDUCTOR_INTELLIGENCE_SYMBOLS,
    ...ENERGY_INTELLIGENCE_SYMBOLS,
    ...SHIPPING_INTELLIGENCE_SYMBOLS,
    ...TECHNOLOGY_INTELLIGENCE_SYMBOLS,
  ];
  const events = [
    ...marketRows,
    ...amdNews, ...ccjNews, ...inswNews, ...googlNews,
    ...amdCongress, ...ccjCongress, ...inswCongress, ...googlCongress,
    ...amdLobbying, ...ccjLobbying, ...inswLobbying, ...googlLobbying,
  ].filter((event) => event.sector !== 'cross_market' || event.symbols.some((symbol) => strategySymbols.includes(symbol as never)));

  const partial = !market.ok;
  return {
    events,
    status: {
      provider: 'finnhub',
      connected: true,
      status: partial ? 'partial' : 'live',
      note: partial
        ? `Finnhub key is configured; at least one endpoint was unavailable on the current plan (HTTP ${market.status || 'n/a'}). Optional premium feeds degrade safely.`
        : 'Finnhub market/company news and public-disclosure probes are active across semiconductor, energy, shipping and technology research lanes. Premium endpoint availability depends on the Finnhub plan.',
    },
  };
}
