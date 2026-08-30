/**
 * Browser API client.
 *
 * Every call is a same-origin request to a Netlify Function with
 * `credentials: 'same-origin'` so the HttpOnly session cookie travels and no
 * token is ever handled by JavaScript. Nothing in the browser holds a broker
 * credential, an API key or a session token, and nothing is written to
 * localStorage.
 */
import type {
  buildIncomePayload,
  buildPortfolioPayload,
  buildSignalsPayload,
  buildSimulation,
  SimulatorRequest,
} from './analysis.js';
import type { BrokerStatus } from '../brokers/registry.js';
import type { OrderStatus } from '../brokers/types.js';
import type { StrategyConfig, IncomeMilestone, StrategyLevelInfo } from '../core/config.js';
import type { RiskDecision, RiskFinding, ProposedOrder } from '../risk/types.js';
import type { AllocationPlan } from '../strategy/allocation.js';
import type { RecommendationBrief, AgentSource } from '../agent/types.js';
import type { IntelligenceEvent } from '../intelligence/types.js';

const BASE = '/.netlify/functions';
const ANALYZE_POLL_TIMEOUT_MS = 8 * 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError('Network unavailable. Check your connection and try again.', 0, 'NETWORK');
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!response.ok) {
        throw new ApiError(
          `The service returned HTTP ${response.status} without a JSON error envelope.`,
          response.status,
          'NON_JSON_RESPONSE',
        );
      }
      throw new ApiError('The service returned an invalid response.', response.status, 'INVALID_JSON');
    }
  }

  if (!response.ok) {
    const error = (body.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      error.message ?? `Request failed (${response.status}).`,
      response.status,
      error.code ?? 'UNKNOWN',
      body,
    );
  }
  return body as T;
}

export type PortfolioResponse = ReturnType<typeof buildPortfolioPayload> & {
  brokers: BrokerStatus[];
  configPersisted: boolean;
  configNote: string | null;
  priorSnapshotAsOf: string | null;
};

export type IncomeResponse = ReturnType<typeof buildIncomePayload>;
export type SignalsResponse = ReturnType<typeof buildSignalsPayload>;
export type SimulationResponse = ReturnType<typeof buildSimulation>;

export interface SessionResponse {
  authenticated: boolean;
  mode: 'authenticated' | 'public_demo' | null;
  setupRequired: boolean;
  publicDemo: boolean;
  expiresInSeconds: number | null;
  sessionTtlMinutes: number;
  environment: {
    databaseAttached: boolean;
    modelAvailable: boolean;
    modelProvider: 'openai' | 'claude' | 'deterministic';
    model: string | null;
    recurringShadowUsesModel: boolean;
    executionEnabled: boolean;
    phase: number;
  };
}

export interface AnalyzeResponse {
  asOf: string;
  modelInputAsOf?: string;
  containsMockData: boolean;
  sourceNotes: string[];
  recommendationId: number | null;
  question: string;
  standingQuestions: string[];
  capital: number;
  brief: RecommendationBrief;
  source: AgentSource;
  model: string | null;
  fallbackReason: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  riskDecision: RiskDecision;
  baseline: { plan: AllocationPlan; riskDecision: RiskDecision };
  executionEnabled: boolean;
  phaseNote: string;
}

interface AnalyzePendingResponse {
  pending: true;
  status: string;
  jobToken: string;
  asOf: string;
  question: string;
  capital: number;
  model: string | null;
}

type AnalyzePollResponse = AnalyzeResponse | AnalyzePendingResponse;

function isAnalyzePending(value: AnalyzePollResponse): value is AnalyzePendingResponse {
  return 'pending' in value && value.pending === true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function analyzeWithPolling(question: string, capital?: number): Promise<AnalyzeResponse> {
  let response = await request<AnalyzePollResponse>('/analyze', {
    method: 'POST',
    body: JSON.stringify({ question, capital }),
  });
  if (!isAnalyzePending(response)) return response;

  const deadline = Date.now() + ANALYZE_POLL_TIMEOUT_MS;
  let delayMs = 1500;
  while (Date.now() < deadline) {
    await wait(delayMs);
    response = await request<AnalyzePollResponse>('/analyze-status', {
      method: 'POST',
      body: JSON.stringify({ jobToken: response.jobToken }),
    });
    if (!isAnalyzePending(response)) return response;
    delayMs = Math.min(3000, delayMs + 250);
  }

  throw new ApiError(
    'The Treasury strategist is still processing. Please try again in a moment.',
    408,
    'ANALYSIS_POLL_TIMEOUT',
  );
}

export interface ModelStrategyResponse {
  asOf: string;
  recommendationId: number | null;
  event: IntelligenceEvent | null;
  capital: number;
  mandateAccounts: Array<{ id: string; name: string; broker: string; cash: number; role: string }>;
  research: { available: boolean; model: string | null; text: string; usage: { inputTokens: number; outputTokens: number } | null };
  source: AgentSource;
  model: string | null;
  fallbackReason: string | null;
  brief: RecommendationBrief;
  riskDecision: RiskDecision;
  impact: {
    currentMonthlyIncome: number;
    proposedMonthlyIncome: number;
    monthlyIncomeDelta: number;
    currentIncomeCapital: number;
    proposedIncomeCapital: number;
    proposedRate: number;
    cashRemaining: number;
    immediateIncomeEffectKnown: boolean;
  };
  proposedProjection: SimulationResponse['projection'];
  manualSteps: string[];
  note: string;
}

export interface AdoptStrategyResponse {
  adopted: true;
  recommendationId: number;
  headline: string;
  riskDecision: RiskDecision;
  staged: Array<{
    stagedPreviewId: number | null;
    broker: string;
    accountId: string;
    symbol: string;
    side: 'buy' | 'sell';
    requestedNotional: number;
    allowedNotional: number;
    estimatedQuantity: number | null;
    approved: boolean;
    executionPath: 'robinhood_guarded' | 'schwab_ymag_guarded' | 'manual_required' | 'blocked';
    instruction: string;
    findings: RiskFinding[];
  }>;
  crossBroker: boolean;
  fundingInstruction: string | null;
  note: string;
}

export interface SettingsResponse {
  config: StrategyConfig;
  defaults: StrategyConfig;
  persisted: boolean;
  note: string | null;
  databaseAttached: boolean;
  milestones: IncomeMilestone[];
  strategyLevels: StrategyLevelInfo[];
  readOnly: boolean;
}

export interface ActivityEvent {
  id: number;
  createdAt: string;
  category: string;
  action: string;
  severity: string;
  message: string;
  detail: unknown;
}

export interface ActivityRecommendation {
  id: number;
  createdAt: string;
  question: string;
  availableCapital: number;
  source: string;
  model: string | null;
  headline: string;
  confidence: string;
  brief: RecommendationBrief;
  deterministicOutcome: unknown;
  userAction: string;
  userNote: string | null;
  actedAt: string | null;
}

export interface ActivityOrderPreview {
  id: number;
  createdAt: string;
  symbol: string;
  side: string;
  accountExternalId: string;
  broker: string;
  notional: number | null;
  quantity: number | null;
  origin: string;
  approvedByRisk: boolean;
  allowedNotional: number;
  status: string;
  rationale: string;
}

export interface ActivityResponse {
  databaseAttached: boolean;
  note: string | null;
  recommendations: ActivityRecommendation[];
  orderPreviews: ActivityOrderPreview[];
  events: ActivityEvent[];
}

export interface OrderPreviewResponse {
  asOf: string;
  containsMockData: boolean;
  decision: RiskDecision;
  executionEnabled: boolean;
  note: string;
}

export interface SchwabQuoteResponse {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  asOf: string;
}

export interface SchwabStatusResponse {
  connected: boolean;
  executionEnabled: boolean;
  connectUrl: string;
  symbol: 'YMAG';
  accounts: {
    id: string;
    name: string;
    cash: number;
    allocationEligible: boolean;
    tradeEligible: boolean;
  }[];
  quote: SchwabQuoteResponse | null;
  fundingApiAvailable: false;
  note: string;
}

export interface SchwabTradePreviewResponse {
  approved: boolean;
  previewId: number | null;
  symbol: 'YMAG';
  account: { id: string; name: string; cash: number };
  quote: SchwabQuoteResponse;
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

export interface SchwabExecutionResponse {
  executed: true;
  previewId: number;
  symbol: 'YMAG';
  quantity: number;
  estimatedNotional: number;
  quote: SchwabQuoteResponse;
  order: OrderStatus;
  note: string;
}

export const api = {
  session: () => request<SessionResponse>('/auth-session'),
  login: (passcode: string) =>
    request<{ authenticated: boolean; expiresInMinutes: number }>('/auth-login', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),
  logout: () => request<{ authenticated: boolean }>('/auth-logout', { method: 'POST' }),

  portfolio: () => request<PortfolioResponse>('/portfolio'),
  income: () => request<IncomeResponse>('/income'),
  signals: () => request<SignalsResponse>('/signals'),
  simulate: (body: SimulatorRequest) =>
    request<SimulationResponse>('/simulate', { method: 'POST', body: JSON.stringify(body) }),

  analyze: (question: string, capital?: number) => analyzeWithPolling(question, capital),
  modelStrategy: (body: { question: string; eventFingerprint?: string | null; capital?: number; horizonMonths?: number }) =>
    request<ModelStrategyResponse>('/model-strategy', { method: 'POST', body: JSON.stringify(body) }),
  adoptStrategy: (recommendationId: number, eventFingerprint?: string | null) =>
    request<AdoptStrategyResponse>('/adopt-strategy', {
      method: 'POST',
      body: JSON.stringify({ recommendationId, eventFingerprint: eventFingerprint ?? undefined }),
    }),

  settings: () => request<SettingsResponse>('/settings'),
  saveSettings: (patch: Partial<StrategyConfig>) =>
    request<{ config: StrategyConfig; persisted: boolean; note: string | null; rejected: string[] }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  activity: (limit = 50) => request<ActivityResponse>(`/activity?limit=${limit}`),
  recordDecision: (recommendationId: number, action: 'approved' | 'rejected' | 'edited', note?: string) =>
    request<{ recommendationId: number; userAction: string; executed: boolean; note: string }>('/activity', {
      method: 'POST',
      body: JSON.stringify({ recommendationId, action, note }),
    }),

  orderPreview: (
    orders: {
      accountId: string;
      symbol: string;
      side: 'buy' | 'sell';
      notional?: number;
      quantity?: number;
      rationale?: string;
      origin?: ProposedOrder['origin'];
    }[],
    recommendationId?: number | null,
  ) =>
    request<OrderPreviewResponse>('/order-preview', {
      method: 'POST',
      body: JSON.stringify({ orders, recommendationId }),
    }),

  schwabStatus: () => request<SchwabStatusResponse>('/schwab-status'),
  schwabTradePreview: (accountId: string, quantity: number) =>
    request<SchwabTradePreviewResponse>('/schwab-trade-preview', {
      method: 'POST',
      body: JSON.stringify({ accountId, quantity }),
    }),
  executeOrder: (previewId: number, confirmation: string) =>
    request<SchwabExecutionResponse>('/order-execute', {
      method: 'POST',
      body: JSON.stringify({ previewId, confirmation }),
    }),
};

export type { SimulatorRequest };
