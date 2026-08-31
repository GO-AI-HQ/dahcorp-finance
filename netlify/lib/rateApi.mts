import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import {
  normalizeRateApiDepositBenchmark,
  RATEAPI_SAVINGS_BENCHMARK_REQUEST,
  unavailableSavingsRateBenchmark,
  type RateApiDepositBenchmarkPayload,
  type SavingsRateBenchmark,
} from '../../src/core/rateApiContract.js';
import { latestIntelligenceEventByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';

const RATEAPI_PURPOSE = 'household_liquidity_savings_benchmark';
const VERIFIED_MAX_AGE_DAYS = 7;

function envValue(key: string): string | undefined {
  try {
    const value = Netlify.env.get(key);
    if (value != null) return value;
  } catch {
    // Local/server tests may not expose the Netlify global.
  }
  return undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fetchSavingsRateBenchmark(fetchImpl: typeof fetch = fetch): Promise<SavingsRateBenchmark> {
  const key = envValue('RATEAPI_API_KEY')?.trim();
  if (!key) return unavailableSavingsRateBenchmark('not_configured', 'Live savings-rate data is not configured.');

  try {
    const response = await fetchImpl('https://api.rateapi.dev/v1/deposit-rates', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: JSON.stringify(RATEAPI_SAVINGS_BENCHMARK_REQUEST),
    });
    if (!response.ok) {
      const note = response.status === 429
        ? 'RateAPI has reached its current request limit. The last verified savings benchmark will be used if one is stored.'
        : `RateAPI returned HTTP ${response.status}. Exact retail savings rates are temporarily unavailable.`;
      return unavailableSavingsRateBenchmark('unavailable', note);
    }
    return normalizeRateApiDepositBenchmark(await response.json() as RateApiDepositBenchmarkPayload);
  } catch {
    return unavailableSavingsRateBenchmark('unavailable', 'RateAPI could not be reached. Exact retail savings rates are temporarily unavailable.');
  }
}

function fromEvent(event: IntelligenceEvent): SavingsRateBenchmark | null {
  if (event.metadata?.purpose !== RATEAPI_PURPOSE) return null;
  const raw = event.metadata;
  const asOf = typeof raw.asOf === 'string' ? raw.asOf : event.occurredAt.slice(0, 10);
  const ageDays = Math.max(0, (Date.now() - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return {
    source: 'rateapi',
    status: ageDays <= VERIFIED_MAX_AGE_DAYS ? 'verified' : 'stale',
    asOf,
    bestPublishedApy: numberOrNull(raw.bestPublishedApy),
    bestPublishedInstitution: typeof raw.bestPublishedInstitution === 'string' ? raw.bestPublishedInstitution : null,
    medianApy: numberOrNull(raw.medianApy),
    minApy: numberOrNull(raw.minApy),
    maxApy: numberOrNull(raw.maxApy),
    institutionCount: numberOrNull(raw.institutionCount),
    note: ageDays <= VERIFIED_MAX_AGE_DAYS
      ? 'Using the most recent verified RateAPI savings benchmark.'
      : 'The stored savings benchmark is more than a week old. Keep the last verified value visible, but treat it as stale until the next successful refresh.',
  };
}

export async function storedSavingsRateBenchmark(): Promise<SavingsRateBenchmark | null> {
  const event = await latestIntelligenceEventByPurpose(RATEAPI_PURPOSE);
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
      purpose: RATEAPI_PURPOSE,
      asOf: benchmark.asOf,
      bestPublishedApy: benchmark.bestPublishedApy,
      bestPublishedInstitution: benchmark.bestPublishedInstitution,
      medianApy: benchmark.medianApy,
      minApy: benchmark.minApy,
      maxApy: benchmark.maxApy,
      institutionCount: benchmark.institutionCount,
      cachePolicy: 'Low-frequency supporting benchmark. Refresh twice weekly; keep the last verified value between refreshes.',
      caveat: 'Do not treat the highest published APY as personally available until eligibility, balance tier, geography, membership rules, insurance and access are confirmed.',
    },
  };
  await persistIntelligenceEvents([event]);
  return benchmark;
}

export type { SavingsRateBenchmark } from '../../src/core/rateApiContract.js';
