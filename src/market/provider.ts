import type { DistributionEvent, PriceBar, Quote } from '../core/types.js';

/**
 * Market-data provider interface.
 *
 * The application only ever talks to this interface, so swapping the mock
 * generator for a live quote/distribution vendor requires no change to the
 * calculation engine, the risk engine or the UI.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly isMock: boolean;
  getQuotes(symbols: string[], asOf: string): Promise<Record<string, Quote>>;
  getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>>;
  getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]>;
}

/** Thrown when a provider is configured but unreachable. */
export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}
