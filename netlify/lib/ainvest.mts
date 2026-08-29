import type { IntelligenceEvent, IntelligenceProviderStatus } from '../../src/intelligence/types.js';
import { sectorForText } from '../../src/intelligence/taxonomy.js';

const AINVEST_BASE = 'https://openapi.ainvest.com/open';
const CONGRESS_WATCH = ['AMD', 'NVDA', 'CCJ', 'INSW', 'SBLK', 'GOOGL', 'AMZN'] as const;

interface AInvestCongressTrade {
  name?: string;
  party?: string;
  state?: string;
  trade_date?: string;
  filing_date?: string;
  reporting_gap?: string;
  trade_type?: string;
  size?: string;
}

interface AInvestEnvelope {
  data?: { data?: AInvestCongressTrade[] };
  status_code?: number;
  status_msg?: string;
}

function apiKey(): string | null {
  const raw = Netlify.env.get('AINVEST_API_KEY') || Netlify.env.get('AINVEST_KEY');
  if (!raw) return null;
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return value.replace(/^Bearer\s+/i, '').trim() || null;
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function dateIso(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return `${value}T12:00:00.000Z`;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const delta = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(delta) ? Math.max(0, Math.round(delta / 86_400_000)) : null;
}

async function fetchTicker(ticker: string, key: string): Promise<{ status: number; rows: AInvestCongressTrade[] }> {
  const url = new URL(`${AINVEST_BASE}/ownership/congress`);
  url.searchParams.set('ticker', ticker);
  url.searchParams.set('page', '1');
  url.searchParams.set('size', '10');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!response.ok) return { status: response.status, rows: [] };
  try {
    const payload = (await response.json()) as AInvestEnvelope;
    if (payload.status_code !== 0 || !Array.isArray(payload.data?.data)) return { status: response.status, rows: [] };
    return { status: response.status, rows: payload.data.data };
  } catch {
    return { status: response.status, rows: [] };
  }
}

async function normalize(ticker: string, trade: AInvestCongressTrade): Promise<IntelligenceEvent | null> {
  const tradeAt = dateIso(trade.trade_date);
  if (!tradeAt) return null;
  const filingAt = dateIso(trade.filing_date);
  const discoveredAt = filingAt ?? new Date().toISOString();
  const reportingGapDays = daysBetween(tradeAt, filingAt);
  const side = String(trade.trade_type ?? '').toLowerCase();
  const direction = side === 'buy' ? 'constructive' : side === 'sell' ? 'restrictive' : 'unknown';
  const person = String(trade.name ?? 'U.S. congressional filer').trim();
  const headline = `${person} disclosed a ${side || 'trade'} in ${ticker}`;
  const sector = sectorForText(`${headline} ${ticker}`, [ticker]);
  return {
    fingerprint: await fingerprint(['ainvest-congress', ticker, person, trade.trade_date ?? '', trade.filing_date ?? '', side, trade.size ?? '']),
    occurredAt: tradeAt,
    discoveredAt,
    source: 'AInvest congressional disclosure data',
    sourceClass: 'capital_signal',
    sourceUrl: null,
    sourceQuality: 0.82,
    sector,
    eventType: 'CAPITAL_DISCLOSURE',
    headline,
    summary: reportingGapDays == null
      ? `Public disclosure for ${ticker}; reporting delay could not be calculated.`
      : `The transaction occurred ${reportingGapDays} day${reportingGapDays === 1 ? '' : 's'} before the filing date. Treat this as retrospective positioning, not a real-time trade signal.`,
    symbols: [ticker],
    latency: reportingGapDays != null && reportingGapDays <= 2 ? 'delayed_disclosure' : 'retrospective',
    direction,
    severity: 'info',
    sentimentScore: null,
    metadata: {
      politician: person,
      party: trade.party ?? null,
      state: trade.state ?? null,
      tradeDate: trade.trade_date ?? null,
      filingDate: trade.filing_date ?? null,
      reportingGap: trade.reporting_gap ?? null,
      reportingGapDays,
      tradeType: side || null,
      size: trade.size ?? null,
      disclosureRole: 'context_only',
    },
  };
}

export async function fetchAInvestCongressIntelligence(): Promise<{ events: IntelligenceEvent[]; status: IntelligenceProviderStatus }> {
  const key = apiKey();
  if (!key) {
    return {
      events: [],
      status: { provider: 'ainvest', connected: false, status: 'not_configured', note: 'AInvest congressional-trade enrichment is not configured.' },
    };
  }

  const results = await Promise.all(CONGRESS_WATCH.map(async (ticker) => ({ ticker, result: await fetchTicker(ticker, key) })));
  const events: IntelligenceEvent[] = [];
  let failed = 0;
  for (const { ticker, result } of results) {
    if (result.status !== 200) failed += 1;
    for (const row of result.rows) {
      const event = await normalize(ticker, row);
      if (event) events.push(event);
    }
  }

  return {
    events,
    status: {
      provider: 'ainvest',
      connected: true,
      status: failed ? 'partial' : 'live',
      note: failed
        ? `AInvest is configured; ${failed} of ${CONGRESS_WATCH.length} ticker probes were unavailable. Available disclosures were still normalized.`
        : `AInvest congressional disclosures are enriching ${CONGRESS_WATCH.length} strategy-relevant tickers with explicit filing latency.`,
    },
  };
}
