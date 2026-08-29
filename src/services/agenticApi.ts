import { ApiError } from './api.js';
import type { AgenticExecutionMode } from '../core/config.js';

const BASE = '/.netlify/functions';

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
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

export interface AgenticReadinessDimension {
  key: string;
  label: string;
  weight: number;
  progress: number;
  detail: string;
}

export interface AgenticShadowObservation {
  id: number;
  createdAt: string;
  marketDate: string;
  strategy: string;
  symbol: string;
  action: string;
  price: number;
  score: number;
  suggestedNotional: number;
  rationale: string;
  modelSource: string;
  model: string | null;
  signals: unknown;
  riskVerdict: unknown | null;
  outcome: unknown | null;
}

export interface AgenticReadinessResponse {
  asOf: string;
  mode: AgenticExecutionMode;
  overall: number;
  stage: string;
  explanation: string;
  allowlist: string[];
  cashQueue: {
    enabled: boolean;
    requireQualifiedSignal: boolean;
    availableCash: number;
  };
  dimensions: AgenticReadinessDimension[];
  evidence: {
    totalObservations: number;
    distinctMarketDays: number;
    observationsWithOutcome: number;
    actionCounts: Record<string, number>;
    symbolCounts: Record<string, number>;
    latest: AgenticShadowObservation[];
  };
}

export const agenticApi = {
  readiness: () => request<AgenticReadinessResponse>('/agentic-readiness'),
};
