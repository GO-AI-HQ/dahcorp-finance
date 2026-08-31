import type { DistributionEvent, PriceBar } from '../../src/core/types.js';
import { OpenBBGatewayMarketDataProvider } from './openbbGatewayProvider.mts';

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.toUpperCase().trim()).filter(Boolean))];
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 160) : 'provider request failed';
}

/**
 * Keeps one unsupported symbol from erasing otherwise valid OpenBB evidence.
 *
 * OpenBB provider coverage is not perfectly uniform across every ETF, fund and
 * research ticker. Price history and dividend history are therefore collected
 * per symbol. A symbol that fails remains UNKNOWN while successful symbols are
 * still returned to the portfolio and income engines.
 */
export class ResilientOpenBBGatewayMarketDataProvider extends OpenBBGatewayMarketDataProvider {
  async getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>> {
    const rows = await Promise.all(normalizeSymbols(symbols).map(async (symbol) => {
      try {
        const result = await super.getPriceHistory([symbol], asOf, days);
        return [symbol, result[symbol] ?? []] as const;
      } catch (error) {
        console.warn(`[dahcorp] OpenBB price history unavailable for ${symbol}: ${safeMessage(error)}`);
        return [symbol, []] as const;
      }
    }));
    return Object.fromEntries(rows);
  }

  async getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]> {
    const rows = await Promise.all(normalizeSymbols(symbols).map(async (symbol) => {
      try {
        return await super.getDistributions([symbol], asOf, days);
      } catch (error) {
        console.warn(`[dahcorp] OpenBB distribution history unavailable for ${symbol}: ${safeMessage(error)}`);
        return [];
      }
    }));
    return rows.flat().sort((a, b) => a.exDate.localeCompare(b.exDate));
  }
}
