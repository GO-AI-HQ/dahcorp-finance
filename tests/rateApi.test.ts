import { afterEach, describe, expect, it } from 'vitest';
import { fetchSavingsRateBenchmark } from '../netlify/lib/rateApi.mts';

const ORIGINAL_KEY = process.env.RATEAPI_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY == null) delete process.env.RATEAPI_API_KEY;
  else process.env.RATEAPI_API_KEY = ORIGINAL_KEY;
});

describe('RateAPI savings benchmark', () => {
  it('reports not configured without a key and does not call the network', async () => {
    delete process.env.RATEAPI_API_KEY;
    let called = false;
    const result = await fetchSavingsRateBenchmark((async () => {
      called = true;
      throw new Error('network should not be called');
    }) as typeof fetch);

    expect(called).toBe(false);
    expect(result.status).toBe('not_configured');
    expect(result.medianApy).toBeNull();
  });

  it('normalizes the official benchmark response without treating the top APY as guaranteed', async () => {
    process.env.RATEAPI_API_KEY = 'test-key';
    const result = await fetchSavingsRateBenchmark((async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ product_category: 'savings', mode: 'benchmark' });
      return new Response(JSON.stringify({
        product_category: 'savings',
        as_of: '2026-08-30',
        best: { lender: 'Example Credit Union', apy: 4.5 },
        market: { min_apy: 0.1, median_apy: 3.4, max_apy: 4.5, institution_count: 120 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch);

    expect(result.status).toBe('verified');
    expect(result.asOf).toBe('2026-08-30');
    expect(result.medianApy).toBe(3.4);
    expect(result.bestPublishedApy).toBe(4.5);
    expect(result.bestPublishedInstitution).toBe('Example Credit Union');
    expect(result.note).toMatch(/not automatically available/i);
  });

  it('returns an unavailable state instead of inventing a rate when the provider is limited', async () => {
    process.env.RATEAPI_API_KEY = 'test-key';
    const result = await fetchSavingsRateBenchmark((async () => new Response('', { status: 429 })) as typeof fetch);

    expect(result.status).toBe('unavailable');
    expect(result.bestPublishedApy).toBeNull();
    expect(result.medianApy).toBeNull();
    expect(result.note).toMatch(/request limit/i);
  });
});
