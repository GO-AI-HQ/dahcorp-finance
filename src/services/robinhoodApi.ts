import { ApiError } from './api.js';
import type { OrderStatus } from '../brokers/types.js';
import type { RiskFinding } from '../risk/types.js';
import type { AgenticExecutionMode } from '../core/config.js';

const BASE = '/.netlify/functions';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError('Network unavailable. Check your connection and try again.', 0, 'NETWORK');
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(error.message ?? `Request failed (${response.status}).`, response.status, error.code ?? 'UNKNOWN', body);
  }
  return body as T;
}

export interface RobinhoodQuoteResponse {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  previousClose: number | null;
  asOf: string;
}

export interface RobinhoodStatusResponse {
  connected: boolean;
  executionEnabled: boolean;
  executionMode: AgenticExecutionMode;
  connectUrl: string;
  manualCompletionRequired: boolean;
  symbol: string;
  allowlist: string[];
  accounts: {
    id: string;
    name: string;
    cash: number;
    allocationEligible: boolean;
    tradeEligible: boolean;
  }[];
  quote: RobinhoodQuoteResponse | null;
  quotes: Record<string, RobinhoodQuoteResponse>;
  toolNames: string[];
  note: string;
}

export interface RobinhoodTradePreviewResponse {
  approved: boolean;
  previewId: number | null;
  symbol: string;
  account: { id: string; name: string; cash: number };
  quote: RobinhoodQuoteResponse;
  quantity: number;
  estimatedTotal: number;
  findings: RiskFinding[];
  brokerPreview?: {
    accepted: boolean;
    estimatedPrice: number | null;
    estimatedShares: number | null;
    estimatedCommission: number | null;
    warnings: string[];
    previewToken: string | null;
  };
  expiresInSeconds: number;
  confirmationText: string | null;
}

export interface RobinhoodExecutionResponse {
  executed: true;
  previewId: number;
  symbol: string;
  quantity: number;
  estimatedNotional: number;
  quote: RobinhoodQuoteResponse;
  order: OrderStatus;
  note: string;
}

export const robinhoodApi = {
  status: () => request<RobinhoodStatusResponse>('/robinhood-status'),
  completeAuth: (callbackUrl: string) => request<{ connected: true; redirect: string }>('/robinhood-auth-complete', {
    method: 'POST',
    body: JSON.stringify({ callbackUrl }),
  }),
  preview: (accountId: string, quantity: number, symbol = 'NVDY') => request<RobinhoodTradePreviewResponse>('/robinhood-trade-preview', {
    method: 'POST',
    body: JSON.stringify({ accountId, quantity, symbol }),
  }),
  execute: (previewId: number, confirmation: string) => request<RobinhoodExecutionResponse>('/robinhood-order-execute', {
    method: 'POST',
    body: JSON.stringify({ previewId, confirmation }),
  }),
};
