import type { DistributionEvent, PriceBar, Quote } from '../../src/core/types.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import { mockMarketDataProvider } from '../../src/market/mockProvider.js';
import type { SchwabAdapter } from '../../src/brokers/schwab/adapter.js';

interface SchwabQuoteNode {
  symbol?: string;
  quote?: {
    mark?: number;
    lastPrice?: number;
    bidPrice?: number;
    askPrice?: number;
    closePrice?: number;
    netPercentChange?: number;
    totalVolume?: number;
    '52WeekHigh'?: number;
    '52WeekLow'?: number;
    tradeTime?: number;
    quoteTime?: number;
  };
  regular?: {
    regularMarketLastPrice?: number;
    regularMarketPercentChange?: number;
    regularMarketTradeTime?: number;
  };
  reference?: { description?: string };
}

interface SchwabPriceHistoryPayload {
  symbol?: string;
  empty?: boolean;
  previousClose?: number;
  candles?: Array<{
    close?: number;
    datetime?: number;
  }>;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Schwab quote/history provider.
 *
 * `allowMockFallback` exists only for local/demo compatibility. Production
 * DAHCorp defaults it false so a provider failure becomes missing/UNKNOWN
 * evidence, never a synthetic price, history series or distribution.
 */
export class SchwabHybridMarketDataProvider implements MarketDataProvider {
  readonly id: string;
  readonly isMock: boolean;
  readonly sourceNotes: string[];

  private readonly marketBaseUrl: string;
  private readonly liveHistorySymbols: Set<string>;

  constructor(
    private readonly schwab: SchwabAdapter,
    env: NodeJS.ProcessEnv = process.env,
    liveHistorySymbols: string[] = [],
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly allowMockFallback = false,
  ) {
    this.marketBaseUrl = (env.SCHWAB_MARKET_DATA_BASE_URL?.trim() || 'https://api.schwabapi.com/marketdata/v1').replace(/\/$/, '');
    this.liveHistorySymbols = new Set(liveHistorySymbols.map((symbol) => symbol.toUpperCase()));
    this.id = allowMockFallback ? 'schwab-live-hybrid' : 'schwab-live-strict';
    this.isMock = allowMockFallback;
    this.sourceNotes = allowMockFallback
      ? [
          'Current equity quotes are sourced from Schwab Market Data Production when available.',
          'Daily price history for the Agentic strategy universe is sourced from Schwab Market Data Production when available.',
          'Fixture fallback is enabled for local/demo compatibility; distribution-derived projections can remain synthetic.',
        ]
      : [
          'Current equity quotes are sourced from Schwab Market Data Production when available.',
          'Daily price history for the Agentic strategy universe is sourced from Schwab Market Data Production when available.',
          'Production-only mode is active: unavailable prices/history/distributions remain UNKNOWN and no fixture data is substituted.',
        ];
  }

  private async authHeaders() {
    const accessToken = await this.schwab.accessToken();
    return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  }

  async getQuotes(symbols: string[], asOf: string): Promise<Record<string, Quote>> {
    const normalized = [...new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean))];
    const fallback = this.allowMockFallback ? await mockMarketDataProvider.getQuotes(normalized, asOf) : {};
    if (!normalized.length) return fallback;

    try {
      const query = new URLSearchParams({ symbols: normalized.join(','), fields: 'quote,regular,reference' });
      const response = await this.fetchImpl(`${this.marketBaseUrl}/quotes?${query.toString()}`, {
        headers: await this.authHeaders(),
      });
      if (!response.ok) throw new Error(`Schwab quote request failed with status ${response.status}.`);
      const payload = (await response.json()) as Record<string, SchwabQuoteNode>;
      const out: Record<string, Quote> = { ...fallback };

      for (const symbol of normalized) {
        const node = payload[symbol];
        if (!node) continue;
        const q = node.quote ?? {};
        const regular = node.regular ?? {};
        const price = finite(q.mark) ?? finite(q.lastPrice) ?? finite(regular.regularMarketLastPrice);
        if (price == null || price <= 0) continue;
        const pctRaw = finite(q.netPercentChange) ?? finite(regular.regularMarketPercentChange);
        const previousClose = finite(q.closePrice) ?? (pctRaw != null && pctRaw > -99.9 ? price / (1 + pctRaw / 100) : null) ?? price;
        const time = finite(q.tradeTime) ?? finite(q.quoteTime) ?? finite(regular.regularMarketTradeTime);
        out[symbol] = {
          symbol,
          price,
          previousClose,
          dayChangePct: previousClose > 0 ? price / previousClose - 1 : 0,
          bid: finite(q.bidPrice) ?? undefined,
          ask: finite(q.askPrice) ?? undefined,
          avgVolume: finite(q.totalVolume) ?? undefined,
          high52w: finite(q['52WeekHigh']) ?? undefined,
          low52w: finite(q['52WeekLow']) ?? undefined,
          asOf: time != null ? new Date(time).toISOString() : new Date().toISOString(),
          dataQuality: 'live',
        };
      }
      return out;
    } catch (error) {
      console.warn(
        `[dahcorp] Schwab live quote batch unavailable; ${this.allowMockFallback ? 'using labelled fixture fallback' : 'leaving quotes UNKNOWN'}.`,
        error instanceof Error ? error.message : 'unknown error',
      );
      return fallback;
    }
  }

  async getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>> {
    const normalized = [...new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean))];
    const out = this.allowMockFallback ? await mockMarketDataProvider.getPriceHistory(normalized, asOf, days) : {};
    const strategySymbols = normalized.filter((symbol) => this.liveHistorySymbols.has(symbol));
    if (!strategySymbols.length) return out;

    const end = new Date(`${asOf}T23:59:59.999Z`).getTime();
    const start = end - Math.max(days * 2, 550) * 86_400_000;

    await Promise.all(
      strategySymbols.map(async (symbol) => {
        try {
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
          const response = await this.fetchImpl(`${this.marketBaseUrl}/pricehistory?${query.toString()}`, {
            headers: await this.authHeaders(),
          });
          if (!response.ok) throw new Error(`status ${response.status}`);
          const payload = (await response.json()) as SchwabPriceHistoryPayload;
          const bars = (payload.candles ?? [])
            .map((candle) => {
              const close = finite(candle.close);
              const datetime = finite(candle.datetime);
              return close != null && close > 0 && datetime != null ? { date: isoDate(datetime), close } : null;
            })
            .filter((bar): bar is PriceBar => bar != null)
            .sort((a, b) => a.date.localeCompare(b.date));
          if (bars.length >= 20) out[symbol] = bars.slice(-Math.max(days, 60));
        } catch (error) {
          console.warn(
            `[dahcorp] Schwab price history unavailable for ${symbol}; ${this.allowMockFallback ? 'using labelled fixture fallback' : 'leaving history UNKNOWN'}.`,
            error instanceof Error ? error.message : 'unknown error',
          );
        }
      }),
    );

    return out;
  }

  async getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]> {
    return this.allowMockFallback ? mockMarketDataProvider.getDistributions(symbols, asOf, days) : [];
  }
}
