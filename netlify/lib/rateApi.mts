import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { persistIntelligenceEvents, recentIntelligenceEvents } from './intelligenceStore.mts';

type RuntimeEnv = Record<string, string | undefined>;

function envValue(key: string, env: RuntimeEnv = process.env): string | undefined {
  if (env[key] != null) return env[key];
  try {
    const netlify = (globalThis as typeof globalThis & {
      Netlify?: { env?: { get?: (name: string) => string | undefined } };
    }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

interface RateApiDepositBenchmarkPayload {
  product_category?: string;
  as_of?: string;
  best?: {
    lender?: string | null;
    institution?: string | null;
    apy?: number | null;
  } | null;
  market?: {
    min_apy?: number | null;
    median_apy?: number | null;
    max_apy?: number | null;
    institution_count?: number | null;
    rate_count?: number | null;
  } | null;
}

export interface SavingsRateBenchmark {
  source: 'rateapi';
  status: 'verified' | 'stale' | 'unavailable' | 'not_configured';
  asOf: string | null;
  bestPublishedApy: number | null;
  bestPublishedInstitution: string | null;
  medianApy: number | null;
  minApy: number | null;
  maxApy: number | null;
  institutionCount: number | null;
  note: string;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalize(payload: RateApiDepositBenchmarkPayload): SavingsRateBenchmark {
  const asOf = typeof payload.as_of === 'string' && /^\d{4}-\d{2}-\d{2}/.test(payload.as_of)
    ? payload.as_of.slice(0, 10)
    : null;
  const bestPublishedApy = numberOrNull(payload.best?.apy);
  const bestPublishedInstitution = typeof payload.best?.lender === 'string'
    ? payload.best.lender
    : typeof payload.best?.institution === 'string'
      ? payload.best.institution
      : null;
  const market = payload.market ?? {};
  return {
    source: 'rateapi',
    status: asOf ? 'verified' : 'unavailable',
    asOf,
    bestPublishedApy,
    bestPublishedInstitution,
    medianApy: numberOrNull(market.median_apy),
    minApy: numberOrNull(market.min_apy),
    maxApy: numberOrNull(market.max_apy),
    institutionCount: numberOrNull(market.institution_count),
    note: asOf
      ? 'Verified savings-rate benchmark from RateAPI. A published top APY is not automatically available to you; eligibility, balance tiers, geography, membership rules and transfer timing still matter.'
      : 'RateAPI returned no dated savings benchmark. Exact retail savings rates remain unknown.',
  };
}

function unavailable(status: SavingsRateBenchmark['status'], note: string): SavingsRateBenchmark {
  return {
    source: 'rateapi', status, asOf: null,
    bestPublishedApy: null, bestPublishedInstitution: null,
    medianApy: null, minApy: null, maxApy: null, institutionCount: null,
    note,
  };
}

export async function fetchSavingsRateBenchmark(fetchImpl: typeof fetch = fetch): Promise<SavingsRateBenchmark> {
  const key = envValue('RATEAPI_API_KEY')?.trim();
  if (!key) return unavailable('not_configured', 'Live savings-rate data is not configured.');

  try {
    const response = await fetchImpl('https://api.rateapi.dev/v1/deposit-rates', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: JSON.stringify({ product_category: 'savings', mode: 'benchmark' }),
    });
    if (!response.ok) {
      const note = response.status === 429
        ? 'RateAPI has reached its current request limit. The last verified savings benchmark will be used if one is stored.'
        : `RateAPI returned HTTP ${response.status}. Exact retail savings rates are temporarily unavailable.`;
      return unavailable('unavailable', note);
    }
    return normalize(await response.json() as RateApiDepositBenchmarkPayload);
  } catch {
    return unavailable('unavailable', 'RateAPI could not be reached. Exact retail savings rates are temporarily unavailable.');
  }
}

function fromEvent(event: IntelligenceEvent): SavingsRateBenchmark | null {
  if (event.metadata?.purpose !== 'household_liquidity_savings_benchmark') return null;
  const raw = event.metadata;
  const asOf = typeof raw.asOf === 'string' ? raw.asOf : event.occurredAt.slice(0, 10);
  const ageDays = Math.max(0, (Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return {
    source: 'rateapi',
    status: ageDays <= 2 ? 'verified' : 'stale',
    asOf,
    bestPublishedApy: numberOrNull(raw.bestPublishedApy),
    bestPublishedInstitution: typeof raw.bestPublishedInstitution === 'string' ? raw.bestPublishedInstitution : null,
    medianApy: numberOrNull(raw.medianApy),
    minApy: numberOrNull(raw.minApy),
    maxApy: numberOrNull(raw.maxApy),
    institutionCount: numberOrNull(raw.institutionCount),
    note: ageDays <= 2
      ? 'Stored RateAPI savings benchmark is current.'
      : 'Stored RateAPI savings benchmark is older than two days. Treat it as stale until the next successful refresh.',
  };
}

export async function storedSavingsRateBenchmark(): Promise<SavingsRateBenchmark | null> {
  const events = await recentIntelligenceEvents(250);
  const event = events.find((row) => row.metadata?.purpose === 'household_liquidity_savings_benchmark');
  return event ? fromEvent(event) : null;
}

export async function refreshSavingsRateBenchmark(): Promise<SavingsRateBenchmark> {
  const benchmark = await fetchSavingsRateBenchmark();
  if (benchmark.status !== 'verified' || !benchmark.asOf) {
    return (await storedSavingsRateBenchmark()) ?? benchmark;
  }

  const event: IntelligenceEvent = {
    fingerprint: await fingerprint(['rateapi-savings-benchmark', benchmark.asOf, String(benchmark.medianApy), String(benchmark.bestPublishedApy)]),
    occurredAt: `${benchmark.asOf}T12:00:00.000Z`,
    discoveredAt: new Date().toISOString(),
    source: 'RateAPI savings benchmark',
    sourceClass: 'market_benchmark',
    sourceUrl: 'https://rateapi.dev/',
    sourceQuality: 0.9,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: benchmark.medianApy == null
      ? 'Verified savings-rate benchmark refreshed'
      : `Savings market median APY: ${benchmark.medianApy.toFixed(2)}%`,
    summary: benchmark.note,
    symbols: [],
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: {
      purpose: 'household_liquidity_savings_benchmark',
      asOf: benchmark.asOf,
      bestPublishedApy: benchmark.bestPublishedApy,
      bestPublishedInstitution: benchmark.bestPublishedInstitution,
      medianApy: benchmark.medianApy,
      minApy: benchmark.minApy,
      maxApy: benchmark.maxApy,
      institutionCount: benchmark.institutionCount,
      caveat: 'Do not treat the highest published APY as personally available until eligibility, balance tier, geography, membership rules, insurance and access are confirmed.',
    },
  };
  await persistIntelligenceEvents([event]);
  return benchmark;
}
