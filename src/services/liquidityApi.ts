import { ApiError } from './api.js';

export interface LiquidityRatesResponse {
  asOf: string;
  savings: {
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
  } | null;
  treasury: {
    status: 'verified' | 'unavailable';
    asOf: string | null;
    annualizedPercent: number | null;
    note: string;
  };
  note: string;
}

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/.netlify/functions${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ApiError('Savings-rate information is temporarily unreachable.', 0, 'NETWORK');
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try { body = JSON.parse(text) as Record<string, unknown>; }
    catch { throw new ApiError('Savings-rate information returned an unreadable response.', response.status, 'INVALID_JSON'); }
  }
  if (!response.ok) {
    const error = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(error.message ?? 'Savings-rate information is unavailable.', response.status, error.code ?? 'RATE_REQUEST_FAILED', body);
  }
  return body as T;
}

export const liquidityApi = {
  rates: () => request<LiquidityRatesResponse>('/liquidity-rates'),
};
