import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { SignedOpenBBGatewayClient } from './openbbGatewayClient.mts';
import { persistIntelligenceEvents } from './intelligenceStore.mts';

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

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Pull a verified short-duration Treasury yield that the household-liquidity
 * model can use as a reference point. It is deliberately not described as a
 * bank savings APY: different products have different insurance, liquidity,
 * settlement, tax and rate-reset characteristics.
 */
export async function refreshCashYieldBenchmark(): Promise<{ event: IntelligenceEvent | null; persisted: number }> {
  const client = new SignedOpenBBGatewayClient();
  if (!client.isConfigured()) return { event: null, persisted: 0 };

  try {
    const payload = await client.get<FredPayload>('/v2/fred/series', new URLSearchParams({
      series: 'DGS3MO',
      start_date: daysAgo(45),
      end_date: new Date().toISOString().slice(0, 10),
    }));
    const observations = (payload.results ?? [])
      .find((row) => String(row.series ?? '').toUpperCase() === 'DGS3MO')
      ?.observations ?? [];
    const latest = observations
      .map((row) => ({ date: String(row.date ?? '').slice(0, 10), value: Number(row.value) }))
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value))
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1);

    if (!latest) return { event: null, persisted: 0 };

    const event: IntelligenceEvent = {
      fingerprint: await fingerprint(['cash-yield-benchmark', latest.date, String(latest.value)]),
      occurredAt: `${latest.date}T00:00:00.000Z`,
      discoveredAt: new Date().toISOString(),
      source: 'Federal Reserve Economic Data — 3-month Treasury yield',
      sourceClass: 'market_benchmark',
      sourceUrl: null,
      sourceQuality: 0.98,
      sector: 'cross_market',
      eventType: 'OTHER',
      headline: `Short-term Treasury cash benchmark: ${latest.value.toFixed(2)}%`,
      summary: `The latest verified 3-month Treasury constant-maturity yield is ${latest.value.toFixed(2)}%. DAHCorp may use this as a reference when comparing places to keep household cash, but it is not the same thing as a bank APY and does not by itself determine where savings should be held.`,
      symbols: [],
      latency: 'near_real_time',
      direction: 'neutral',
      severity: 'info',
      sentimentScore: null,
      metadata: {
        series: 'DGS3MO',
        annualizedPercent: latest.value,
        observationDate: latest.date,
        purpose: 'household_liquidity_cash_benchmark',
        caveat: 'Compare insurance, access, taxes, settlement and product-specific rates before moving household reserve cash.',
      },
    };

    return { event, persisted: await persistIntelligenceEvents([event]) };
  } catch (error) {
    console.warn('[dahcorp] cash yield benchmark unavailable:', error instanceof Error ? error.message : 'unknown error');
    return { event: null, persisted: 0 };
  }
}
