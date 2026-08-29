import type { Config } from '@netlify/functions';
import type { PriceBar } from '../../src/core/types.js';
import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import type { SchwabAdapter } from '../../src/brokers/schwab/adapter.js';
import { buildServerContext } from '../lib/context.mts';
import { recentIntelligenceEvents, updateIntelligenceOutcome } from '../lib/intelligenceStore.mts';

const SECTOR_BENCHMARK: Record<string, string> = {
  semiconductors: 'SMH',
  energy: 'XLE',
  shipping: 'SBLK',
  technology: 'QQQ',
  cross_market: 'SPY',
};

function referenceSymbol(event: IntelligenceEvent): string {
  return event.symbols[0]?.toUpperCase() || SECTOR_BENCHMARK[event.sector] || 'SPY';
}

function returnAt(bars: PriceBar[], baseIndex: number, sessions: number): number | null {
  const base = bars[baseIndex]?.close;
  const future = bars[baseIndex + sessions]?.close;
  return base && future && base > 0 ? future / base - 1 : null;
}

async function liveHistory(adapter: SchwabAdapter, symbol: string): Promise<PriceBar[]> {
  const accessToken = await adapter.accessToken();
  const base = (Netlify.env.get('SCHWAB_MARKET_DATA_BASE_URL')?.trim() || 'https://api.schwabapi.com/marketdata/v1').replace(/\/$/, '');
  const end = Date.now();
  const start = end - 2 * 365 * 86_400_000;
  const query = new URLSearchParams({
    symbol,
    periodType: 'year',
    period: '2',
    frequencyType: 'daily',
    frequency: '1',
    startDate: String(start),
    endDate: String(end),
    needExtendedHoursData: 'false',
    needPreviousClose: 'true',
  });
  const response = await fetch(`${base}/pricehistory?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) return [];
  try {
    const payload = await response.json() as { candles?: Array<{ close?: number; datetime?: number }> };
    return (payload.candles ?? [])
      .map((candle) => {
        if (typeof candle.close !== 'number' || candle.close <= 0 || typeof candle.datetime !== 'number') return null;
        return { date: new Date(candle.datetime).toISOString().slice(0, 10), close: candle.close };
      })
      .filter((bar): bar is PriceBar => bar !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

export default async () => {
  const ctx = await buildServerContext();
  const schwab = ctx.adapters.find((adapter): adapter is SchwabAdapter => adapter.id === 'schwab' && adapter.isConfigured());
  if (!schwab) return;

  const events = await recentIntelligenceEvents(400);
  const symbols = [...new Set(events.map(referenceSymbol))];
  const histories = new Map<string, PriceBar[]>();
  for (const symbol of symbols) histories.set(symbol, await liveHistory(schwab, symbol));

  for (const event of events) {
    const symbol = referenceSymbol(event);
    const bars = histories.get(symbol) ?? [];
    if (!bars.length) continue;
    const eventDate = event.occurredAt.slice(0, 10);
    const baseIndex = bars.findIndex((bar) => bar.date >= eventDate);
    if (baseIndex < 0) continue;
    const oneDay = returnAt(bars, baseIndex, 1);
    const fiveDay = returnAt(bars, baseIndex, 5);
    const twentyDay = returnAt(bars, baseIndex, 20);
    if (oneDay == null && fiveDay == null && twentyDay == null) continue;
    await updateIntelligenceOutcome(event.fingerprint, {
      referenceSymbol: symbol,
      baseDate: bars[baseIndex].date,
      basePrice: bars[baseIndex].close,
      oneDay,
      fiveDay,
      twentyDay,
      calibratedAt: new Date().toISOString(),
    });
  }
};

export const config: Config = {
  schedule: '30 23 * * 1-5',
};
