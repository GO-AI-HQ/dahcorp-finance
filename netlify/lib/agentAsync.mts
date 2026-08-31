import { RECOMMENDATION_TOOL, parseRecommendation } from '../../src/agent/schema.js';
import type { AgentResult, RecommendationBrief } from '../../src/agent/types.js';
import { openAIErrorDiagnostic, safeOpenAIErrorFromPayload, type SafeOpenAIError } from '../../src/agent/openaiDiagnostics.js';
import { openAIRuntimeTreasuryInput, requestAgentRecommendation, type AgentRequest } from './agentModel.mts';
import { isOpenAIResponseId } from './agentJobToken.mts';

interface OpenAIResponsesPayload {
  id?: string;
  status?: string;
  model?: string;
  output?: Array<{ type?: string; name?: string; arguments?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export type AgentStartResult =
  | { state: 'pending'; responseId: string; status: string; model: string }
  | { state: 'completed'; agent: AgentResult };

export type OpenAIBackgroundPoll =
  | { state: 'pending'; status: string; model: string }
  | { state: 'terminal'; status: string; model: string; payload: OpenAIResponsesPayload | null; failureReason: string | null };

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_OPENAI_PROMPT_ID = 'pmpt_6a9286ff3dbc8190b8c15ef4da2e001b0302504ca0de38ab';
const DEFAULT_OPENAI_PROMPT_VERSION = '1';

function envValue(key: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (env) return env[key];
  try {
    const value = Netlify.env.get(key);
    if (value != null) return value;
  } catch {
    // Local/unit-test runtimes may not expose the Netlify global.
  }
  return process.env[key];
}

function normalizeSecret(value: string | undefined): string | null {
  if (!value) return null;
  let normalized = value.trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/^Bearer\s+/i, '').trim() || null;
}

function configuredProvider(env?: NodeJS.ProcessEnv): 'openai' | 'claude' | 'deterministic' {
  const value = envValue('DAHCORP_AGENT_PROVIDER', env)?.trim().toLowerCase();
  if (value === 'claude' || value === 'deterministic') return value;
  return 'openai';
}

function openAIKey(env?: NodeJS.ProcessEnv): string | null {
  return normalizeSecret(envValue('OPENAI_API_KEY', env) || envValue('DAHCORP_SERVICE_ACCOUNT_OPENAI_KEY', env));
}

function openAIModel(env?: NodeJS.ProcessEnv): string {
  return envValue('OPENAI_MODEL', env)?.trim() || envValue('OPENAI_AGENT_MODEL', env)?.trim() || DEFAULT_OPENAI_MODEL;
}

function openAIPromptId(env?: NodeJS.ProcessEnv): string {
  return envValue('OPENAI_PROMPT_ID', env)?.trim() || envValue('OPEN_AI_PROMPT_ID', env)?.trim() || DEFAULT_OPENAI_PROMPT_ID;
}

function openAIPromptVersion(env?: NodeJS.ProcessEnv): string {
  return envValue('OPENAI_PROMPT_VERSION', env)?.trim() || DEFAULT_OPENAI_PROMPT_VERSION;
}

function openAIBaseUrl(env?: NodeJS.ProcessEnv): string {
  return (envValue('OPENAI_BASE_URL', env)?.trim() || 'https://api.openai.com').replace(/\/$/, '');
}

function openAIEndpoint(path: string, env?: NodeJS.ProcessEnv): string {
  const base = openAIBaseUrl(env);
  const root = base.endsWith('/v1') ? base : `${base}/v1`;
  return `${root}/${path.replace(/^\//, '')}`;
}

async function readSafeOpenAIError(response: Response): Promise<SafeOpenAIError> {
  try {
    return safeOpenAIErrorFromPayload(await response.json());
  } catch {
    return { type: null, code: null, param: null };
  }
}

function safeFailure(status: number, providerError: SafeOpenAIError): string {
  const diagnostic = openAIErrorDiagnostic(providerError);
  const suffix = diagnostic ? ` OpenAI error: ${diagnostic}.` : '';
  if (status === 401) return `OpenAI rejected the Treasury background request (HTTP 401).${suffix}`;
  if (status === 403) return `OpenAI authenticated the Treasury background request but denied the requested resource or model (HTTP 403).${suffix}`;
  if (status === 404) return `OpenAI could not find the configured Treasury response, model, or stored prompt (HTTP 404).${suffix}`;
  if (status === 429) return `OpenAI rate or project-spend limits prevented the Treasury request (HTTP 429).${suffix}`;
  if (status >= 500) return `OpenAI is temporarily unavailable (HTTP ${status}).${suffix}`;
  return `The OpenAI Treasury request was rejected with HTTP ${status}.${suffix}`;
}

function deterministicFallback(brief: RecommendationBrief, model: string, reason: string): AgentResult {
  return {
    brief,
    source: 'deterministic',
    model,
    fallbackReason: `${reason} The deterministic strategy brief is shown instead.`,
    usage: null,
  };
}

function requestBody(request: AgentRequest) {
  return {
    model: openAIModel(),
    prompt: {
      id: openAIPromptId(),
      version: openAIPromptVersion(),
    },
    input: openAIRuntimeTreasuryInput(request),
    tools: [{
      type: 'function',
      name: RECOMMENDATION_TOOL.name,
      description: RECOMMENDATION_TOOL.description,
      parameters: RECOMMENDATION_TOOL.input_schema,
      strict: false,
    }],
    tool_choice: { type: 'function', name: RECOMMENDATION_TOOL.name },
    parallel_tool_calls: false,
    background: true,
    store: false,
  };
}

/** SHA-256 of the exact OpenAI runtime input string; no credential material is included. */
export async function fingerprintAgentRuntimeInput(request: AgentRequest): Promise<string> {
  const bytes = new TextEncoder().encode(openAIRuntimeTreasuryInput(request));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function startAgentRecommendation(request: AgentRequest): Promise<AgentStartResult> {
  if (configuredProvider() !== 'openai') {
    return { state: 'completed', agent: await requestAgentRecommendation(request) };
  }

  const apiKey = openAIKey();
  if (!apiKey) {
    return { state: 'completed', agent: await requestAgentRecommendation(request) };
  }

  const model = openAIModel();
  try {
    const response = await fetch(openAIEndpoint('responses'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody(request)),
    });

    if (!response.ok) {
      const providerError = await readSafeOpenAIError(response);
      return {
        state: 'completed',
        agent: deterministicFallback(request.deterministicBrief, model, safeFailure(response.status, providerError)),
      };
    }

    const payload = (await response.json()) as OpenAIResponsesPayload;
    if (!isOpenAIResponseId(payload.id)) {
      return {
        state: 'completed',
        agent: deterministicFallback(request.deterministicBrief, model, 'OpenAI accepted the background request but did not return a usable response id.'),
      };
    }

    return {
      state: 'pending',
      responseId: payload.id,
      status: payload.status ?? 'queued',
      model: payload.model ?? model,
    };
  } catch (error) {
    console.error('[dahcorp] OpenAI background submission failed:', error instanceof Error ? error.message : 'unknown error');
    return {
      state: 'completed',
      agent: deterministicFallback(request.deterministicBrief, model, 'The OpenAI background request could not be submitted.'),
    };
  }
}

export async function pollOpenAIBackground(responseId: string): Promise<OpenAIBackgroundPoll> {
  const model = openAIModel();
  if (!isOpenAIResponseId(responseId)) {
    return { state: 'terminal', status: 'invalid', model, payload: null, failureReason: 'The Treasury background job identifier is invalid.' };
  }

  const apiKey = openAIKey();
  if (!apiKey) {
    return { state: 'terminal', status: 'unavailable', model, payload: null, failureReason: 'OpenAI credentials are not present in this runtime.' };
  }

  try {
    const response = await fetch(openAIEndpoint(`responses/${encodeURIComponent(responseId)}`), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const providerError = await readSafeOpenAIError(response);
      return {
        state: 'terminal',
        status: `http_${response.status}`,
        model,
        payload: null,
        failureReason: safeFailure(response.status, providerError),
      };
    }

    const payload = (await response.json()) as OpenAIResponsesPayload;
    const status = typeof payload.status === 'string' ? payload.status : 'unknown';
    const resolvedModel = payload.model ?? model;
    if (status === 'queued' || status === 'in_progress') {
      return { state: 'pending', status, model: resolvedModel };
    }
    return { state: 'terminal', status, model: resolvedModel, payload, failureReason: null };
  } catch (error) {
    console.error('[dahcorp] OpenAI background polling failed:', error instanceof Error ? error.message : 'unknown error');
    return { state: 'terminal', status: 'poll_error', model, payload: null, failureReason: 'The OpenAI background response could not be retrieved.' };
  }
}

export function backgroundPollToAgentResult(
  poll: Extract<OpenAIBackgroundPoll, { state: 'terminal' }>,
  deterministicBrief: RecommendationBrief,
): AgentResult {
  if (poll.failureReason) return deterministicFallback(deterministicBrief, poll.model, poll.failureReason);
  if (poll.status !== 'completed' || !poll.payload) {
    const safeStatus = /^[A-Za-z0-9_.:-]{1,80}$/.test(poll.status) ? poll.status : 'terminal';
    return deterministicFallback(deterministicBrief, poll.model, `OpenAI background reasoning ended with status ${safeStatus}.`);
  }

  const call = poll.payload.output?.find((item) => item.type === 'function_call' && item.name === RECOMMENDATION_TOOL.name);
  let parsedInput: unknown = null;
  if (call?.arguments) {
    try { parsedInput = JSON.parse(call.arguments); } catch { parsedInput = null; }
  }

  const brief = parseRecommendation(parsedInput);
  const usage = poll.payload.usage
    ? { inputTokens: poll.payload.usage.input_tokens ?? 0, outputTokens: poll.payload.usage.output_tokens ?? 0 }
    : null;

  if (!brief) {
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model: poll.model,
      fallbackReason: 'The completed OpenAI background response did not match the required recommendation schema and was discarded.',
      usage,
    };
  }

  return { brief, source: 'openai', model: poll.model, fallbackReason: null, usage };
}
