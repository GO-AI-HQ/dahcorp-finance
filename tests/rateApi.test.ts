import { describe, expect, it } from 'vitest';
import {
  normalizeRateApiDepositBenchmark,
  RATEAPI_SAVINGS_BENCHMARK_REQUEST,
  unavailableSavingsRateBenchmark,
} from '../src/core/rateApiContract.js';

describe('RateAPI savings benchmark contract', () => {
  it('uses the documented savings benchmark request', () => {
    expect(RATEAPI_SAVINGS_BENCHMARK_REQUEST).toEqual({ product_category: 'savings', mode: 'benchmark' });
  });

  it('normalizes the benchmark response without treating the top APY as guaranteed', () => {
    const result = normalizeRateApiDepositBenchmark({
      product_category: 'savings',
      as_of: '2026-08-30',
      best: { lender: 'Example Credit Union', apy: 4.5 },
      market: { min_apy: 0.1, median_apy: 3.4, max_apy: 4.5, institution_count: 120 },
    });

    expect(result.status).toBe('verified');
    expect(result.asOf).toBe('2026-08-30');
    expect(result.medianApy).toBe(3.4);
    expect(result.bestPublishedApy).toBe(4.5);
    expect(result.bestPublishedInstitution).toBe('Example Credit Union');
    expect(result.note).toMatch(/not automatically available/i);
  });

  it('keeps an unavailable benchmark null instead of inventing a rate', () => {
    const result = unavailableSavingsRateBenchmark('unavailable', 'Provider unavailable.');
    expect(result.status).toBe('unavailable');
    expect(result.bestPublishedApy).toBeNull();
    expect(result.medianApy).toBeNull();
  });
});
