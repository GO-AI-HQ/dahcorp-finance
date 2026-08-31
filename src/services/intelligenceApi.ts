import type { HistoricalRelevance, IntelligenceEventType, IntelligencePayload, IntelligenceSector } from '../intelligence/types.js';
import { ApiError } from './api.js';

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/.netlify/functions${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ApiError('Market information is temporarily unreachable.', 0, 'NETWORK');
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try { body = JSON.parse(text) as Record<string, unknown>; }
    catch { throw new ApiError('The market-data service returned an unreadable response.', response.status, 'INVALID_JSON'); }
  }
  if (!response.ok) {
    const error = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      error.message ?? `Market-data request failed (${response.status}).`,
      response.status,
      error.code ?? 'INTELLIGENCE_REQUEST_FAILED',
      body,
    );
  }
  return body as T;
}

export type EvidenceLaneName =
  | 'options'
  | 'fund_lookthrough'
  | 'maritime'
  | 'energy_positioning'
  | 'filings_insiders'
  | 'earnings'
  | 'crowding'
  | 'government_capital';

export interface EvidenceLaneSummary {
  lane: EvidenceLaneName;
  status: 'live' | 'partial' | 'unavailable';
  sources: string[];
  itemCount: number;
  asOf: string | null;
  caveats: string[];
}

export interface AdvancedEvidenceSummary {
  version: 'v3';
  asOf: string;
  lanes: Record<EvidenceLaneName, EvidenceLaneSummary>;
  fusion: {
    coveragePct: number;
    liveLaneCount: number;
    partialLaneCount: number;
    unavailableLaneCount: number;
    contradictions: string[];
    note: string;
  };
}

export interface IntelligenceDiagnostics {
  asOf: string;
  overall: 'working' | 'warning' | 'blocked' | 'not_configured';
  configuration: {
    gatewayAddressPresent: boolean;
    signingKeyPresent: boolean;
    finnhubPresent: boolean;
    rateApiPresent: boolean;
    fmpPresent: boolean;
  };
  checks: Array<{
    label: string;
    state: 'working' | 'warning' | 'blocked' | 'not_configured';
    httpStatus: number | null;
    detail: string;
  }>;
  nextStep: string;
  note: string;
}

export const intelligenceApi = {
  current: () => request<IntelligencePayload>('/intelligence'),
  refresh: () => request<IntelligencePayload>('/intelligence?refresh=1'),
  advanced: () => request<AdvancedEvidenceSummary>('/intelligence-v3'),
  refreshAdvanced: () => request<AdvancedEvidenceSummary>('/intelligence-v3?refresh=1'),
  diagnostics: () => request<IntelligenceDiagnostics>('/intelligence-diagnostics'),
  historicalRelevance: (eventType: IntelligenceEventType, sector: IntelligenceSector) =>
    request<HistoricalRelevance>(`/historical-relevance?eventType=${encodeURIComponent(eventType)}&sector=${encodeURIComponent(sector)}`),
};
