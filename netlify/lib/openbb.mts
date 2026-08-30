import { createSign } from 'node:crypto';
import type {
  IntelligenceEvent,
  IntelligenceProviderStatus,
  IntelligenceSector,
  MarketBenchmarkLeg,
} from '../../src/intelligence/types.js';
import { marketPulseDirection, marketPulseState } from '../../src/intelligence/marketPulse.js';

/**
 * OpenBB remains a separate service boundary while the fork is AGPL-licensed.
 * DAHCorp calls the deployed REST API and never copies OpenBB source into the
 * proprietary application. The adapter supports IAM-authenticated Cloud Run.
 */

type Sector = Exclude<IntelligenceSector, 'cross_market'>;

const CONFIRMATIONS: Array<{ sector: Sector; name: string; symbol: string }> = [
  { sector: 'shipping', name: 'BDRY', symbol: 'BDRY' },
  { sector: 'semiconductors', name: 'SOXX', symbol: 'SOXX' },
  { sector: 'energy', name: 'XLE', symbol: 'XLE' },
  { sector: 'technology', name: 'XLK', symbol: 'XLK' },
];

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

interface OpenBBHistoricalRow {
  date?: string;
  close?: number;
  adjusted_close?: number;
}

interface OpenBBResponse {
  results?: OpenBBHistoricalRow[];
}

let tokenCache: { audience: string; token: string; expiresAt: number } | null = null;

function baseUrl(): string | null {
  return Netlify.env.get('OPENBB_REST_URL')?.trim().replace(/\/$/, '') || null;
}

function serviceAccount(): ServiceAccountCredentials | null {
  const raw = Netlify.env.get('OPENBB_GOOGLE_SERVICE_ACCOUNT_JSON')?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

async function googleIdToken(audience: string): Promise<string | null> {
  if (tokenCache && tokenCache.audience === audience && tokenCache.expiresAt - Date.now() > 120_000) return tokenCache.token;
  const credentials = serviceAccount();
  if (!credentials) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    target_audience: audience,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { id_token?: string; expires_in?: number };
  if (!body.id_token) return null;
  tokenCache = {
    audience,
    token: body.id_token,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in ?? 3600)) * 1000,
  };
  return body.id_token;
}

async function openBBHeaders(base: string): Promise<Record<string, string>> {
  const audience = Netlify.env.get('OPENBB_AUDIENCE')?.trim() || base;
  const token = await googleIdToken(audience).catch(() => null);
  return token ? { Accept: 'application/json', Authorization: `Bearer ${token}` } : { Accept: 'application/json' };
}

function isoDateDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function closeValue(row: OpenBBHistoricalRow): number | null {
  const value = Number(row.adjusted_close ?? row.close);
  return Number.isFinite(value) ? value : null;
}

function pctChange(current: number, prior: number): number | null {
  return prior > 0 && Number.isFinite(current) && Number.isFinite(prior) ? ((current / prior) - 1) * 100 : null;
}

function nearestPrior(rows: OpenBBHistoricalRow[], targetTime: number): OpenBBHistoricalRow | null {
  let best: OpenBBHistoricalRow | null = null;
  let bestTime = -Infinity;
  for (const row of rows) {
    const time = new Date(String(row.date ?? '')).getTime();
    if (!Number.isFinite(time) || time > targetTime || time < bestTime || closeValue(row) == null) continue;
    best = row;
    bestTime = time;
  }
  return best;
}

async function fetchConfirmation(
  base: string,
  headers: Record<string, string>,
  concept: { sector: Sector; name: string; symbol: string },
): Promise<{ leg: MarketBenchmarkLeg | null; httpStatus: number }> {
  const url = new URL(`${base}/api/v1/equity/price/historical`);
  url.searchParams.set('provider', Netlify.env.get('OPENBB_MARKET_PROVIDER')?.trim() || 'yfinance');
  url.searchParams.set('symbol', concept.symbol);
  url.searchParams.set('start_date', isoDateDaysAgo(45));
  url.searchParams.set('end_date', new Date().toISOString().slice(0, 10));
  const response = await fetch(url, { headers });
  if (!response.ok) return { leg: null, httpStatus: response.status };
  const payload = await response.json() as OpenBBResponse;
  const rows = Array.isArray(payload.results)
    ? payload.results.filter((row) => closeValue(row) != null).sort((a, b) => new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime())
    : [];
  const latest = rows.at(-1);
  const current = latest ? closeValue(latest) : null;
  if (!latest || current == null) return { leg: null, httpStatus: response.status };
  const latestTime = new Date(String(latest.date)).getTime();
  const fivePrior = nearestPrior(rows, latestTime - 7 * 86_400_000);
  const monthPrior = nearestPrior(rows, latestTime - 30 * 86_400_000);
  return {
    httpStatus: response.status,
    leg: {
      name: concept.name,
      symbol: concept.symbol,
      provider: 'openbb',
      last: current,
      return5d: fivePrior && closeValue(fivePrior) != null ? pctChange(current, closeValue(fivePrior) as number) : null,
      return30d: monthPrior && closeValue(monthPrior) != null ? pctChange(current, closeValue(monthPrior) as number) : null,
      asOf: new Date(String(latest.date)).toISOString(),
    },
  };
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function eventForConfirmation(sector: Sector, leg: MarketBenchmarkLeg): Promise<IntelligenceEvent> {
  const state = marketPulseState(leg.return5d, leg.return30d);
  return {
    fingerprint: await fingerprint(['openbb-confirmation', sector, leg.symbol, leg.asOf.slice(0, 10), state]),
    occurredAt: leg.asOf,
    discoveredAt: new Date().toISOString(),
    source: 'OpenBB isolated REST service',
    sourceClass: 'openbb',
    sourceUrl: null,
    sourceQuality: 0.72,
    sector,
    eventType: 'MARKET_BENCHMARK_TREND',
    headline: `${leg.symbol} confirmation is ${state.toLowerCase()}`,
    summary: `${leg.symbol} is a liquid confirmation proxy for the ${sector} market pulse; it does not replace the primary macro benchmark.`,
    symbols: [leg.symbol],
    latency: 'near_real_time',
    direction: marketPulseDirection(state),
    severity: 'low',
    sentimentScore: null,
    metadata: { return5d: leg.return5d, return30d: leg.return30d, state, role: 'liquid_confirmation_proxy' },
  };
}

export async function fetchOpenBBIntelligence(): Promise<{
  events: IntelligenceEvent[];
  confirmations: Partial<Record<Sector, MarketBenchmarkLeg>>;
  status: IntelligenceProviderStatus;
}> {
  const base = baseUrl();
  if (!base) {
    return {
      events: [],
      confirmations: {},
      status: {
        provider: 'openbb',
        connected: false,
        status: 'not_configured',
        note: 'OpenBB Cloud Run adapter is ready; configure OPENBB_REST_URL to activate the isolated data fabric.',
      },
    };
  }

  try {
    const headers = await openBBHeaders(base);
    const results = await Promise.all(CONFIRMATIONS.map(async (concept) => ({ concept, result: await fetchConfirmation(base, headers, concept) })));
    const confirmations: Partial<Record<Sector, MarketBenchmarkLeg>> = {};
    const events: IntelligenceEvent[] = [];
    let authFailure = false;
    let failures = 0;
    for (const { concept, result } of results) {
      if (result.httpStatus === 401 || result.httpStatus === 403) authFailure = true;
      if (!result.leg) {
        failures += 1;
        continue;
      }
      confirmations[concept.sector] = result.leg;
      events.push(await eventForConfirmation(concept.sector, result.leg));
    }

    if (authFailure && !Object.keys(confirmations).length) {
      return {
        events: [],
        confirmations: {},
        status: {
          provider: 'openbb',
          connected: true,
          status: 'partial',
          note: serviceAccount()
            ? 'OpenBB Cloud Run is configured, but IAM rejected the Netlify service identity. Grant that service account Cloud Run Invoker on dahcorp-openbb.'
            : 'OpenBB Cloud Run is private. Add OPENBB_GOOGLE_SERVICE_ACCOUNT_JSON for a service account with Cloud Run Invoker; no public endpoint is required.',
        },
      };
    }

    return {
      events,
      confirmations,
      status: {
        provider: 'openbb',
        connected: true,
        status: failures ? 'partial' : 'live',
        note: failures
          ? `OpenBB Cloud Run is connected; ${CONFIRMATIONS.length - failures} of ${CONFIRMATIONS.length} liquid proxy confirmations returned.`
          : 'OpenBB Cloud Run is live and confirming Shipping, Semiconductor, Energy and Technology benchmark regimes through liquid proxies.',
      },
    };
  } catch {
    return {
      events: [],
      confirmations: {},
      status: {
        provider: 'openbb',
        connected: false,
        status: 'unavailable',
        note: 'OpenBB Cloud Run is configured but currently unreachable. DAHCorp continues with direct providers and primary sources.',
      },
    };
  }
}
