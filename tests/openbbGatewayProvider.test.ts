import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OpenBBGatewayMarketDataProvider } from '../netlify/lib/openbbGatewayProvider.mts';

function testSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenBB gateway market provider', () => {
  it('keeps valid dividend history when another symbol is unsupported', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const symbol = url.searchParams.get('symbol');
      if (symbol === 'YMAX') return jsonResponse({ detail: 'unsupported test symbol' }, 400);
      if (symbol === 'YMAG') {
        return jsonResponse({
          provider: 'yfinance',
          results: [
            { symbol: 'YMAG', ex_dividend_date: '2026-08-01', amount: 0.08 },
            { symbol: 'YMAG', ex_dividend_date: '2026-08-08', amount: 0.09 },
            { symbol: 'YMAG', ex_dividend_date: '2026-08-15', amount: 0.085 },
          ],
        });
      }
      return jsonResponse({ results: [] });
    }) as typeof fetch;

    const provider = new OpenBBGatewayMarketDataProvider({
      OPENBB_GATEWAY_URL: 'https://gateway.test',
      OPENBB_GATEWAY_SIGNING_KEY: testSigningKey(),
      OPENBB_MARKET_PROVIDER: 'yfinance',
    }, fetchImpl);

    const rows = await provider.getDistributions(['YMAG', 'YMAX'], '2026-08-31', 420);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.symbol === 'YMAG')).toBe(true);
    expect(rows.at(-1)?.frequency).toBe('weekly');
  });

  it('keeps valid price history when another symbol fails', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const symbol = url.searchParams.get('symbol');
      if (symbol === 'BAD') return jsonResponse({ detail: 'unsupported test symbol' }, 400);
      return jsonResponse({
        provider: 'yfinance',
        results: [
          { date: '2026-08-28', close: 12.1 },
          { date: '2026-08-31', close: 12.4 },
        ],
      });
    }) as typeof fetch;

    const provider = new OpenBBGatewayMarketDataProvider({
      OPENBB_GATEWAY_URL: 'https://gateway.test',
      OPENBB_GATEWAY_SIGNING_KEY: testSigningKey(),
      OPENBB_MARKET_PROVIDER: 'yfinance',
    }, fetchImpl);

    const history = await provider.getPriceHistory(['NVDY', 'BAD'], '2026-08-31', 60);
    expect(history.NVDY).toHaveLength(2);
    expect(history.BAD).toEqual([]);
  });
});
