import { RECOMMENDATION_TOOL, parseRecommendation } from '../../src/agent/schema.js';
import type { AgentDigest } from '../../src/agent/digest.js';
import type { AgentResult, RecommendationBrief } from '../../src/agent/types.js';
import type { ModelDataProvenance } from '../../src/agent/provenance.js';
import { openAIErrorDiagnostic, safeOpenAIErrorFromPayload, type SafeOpenAIError } from '../../src/agent/openaiDiagnostics.js';
import type { StrategyConfig } from '../../src/core/config.js';
import { requestRecommendation as requestClaudeRecommendation } from './claude.mts';

export type AgentProvider = 'openai' | 'claude' | 'deterministic';

export interface AgentRequest {
  question: string;
  digest: AgentDigest;
  capital: number;
  config: StrategyConfig;
  shadowEvidence?: unknown;
  eventIntelligence?: unknown;
  claudeResearchBrief?: unknown;
  dataProvenance?: ModelDataProvenance;
  deterministicBrief: RecommendationBrief;
}

interface OpenAIResponsesPayload {
  output?: Array<{ type?: string; name?: string; arguments?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface OpenAIIdentityProbe {
  status: number | null;
  authenticated: boolean | null;
  error: SafeOpenAIError;
}

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_OPENAI_PROMPT_ID = 'pmpt_6a9286ff3dbc8190b8c15ef4da2e001b0302504ca0de38ab';
const DEFAULT_OPENAI_PROMPT_VERSION = '1';

/**
 * Netlify runtime values are authoritative in production. process.env remains a
 * test/local fallback so core modules can be unit-tested outside Netlify.
 */
function envValue(key: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (env) return env[key];
  try {
    const value = Netlify.env.get(key);
    if (value != null) return value;
  } catch {
    // Local unit tests do not always expose the Netlify global.
  }
  return process.env[key];
}

/**
 * Secret managers sometimes receive values copied as `Bearer sk-...` or with
 * surrounding quotes. The Authorization header itself adds `Bearer`, so strip
 * those presentation wrappers without ever logging or returning the secret.
 */
function normalizeSecret(value: string | undefined): string | null {
  if (!value) return null;
  let normalized = value.trim();
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/^Bearer\s+/i, '').trim();
  return normalized || null;
}

function configuredProvider(env?: NodeJS.ProcessEnv): AgentProvider {
  const value = envValue('DAHCORP_AGENT_PROVIDER', env)?.trim().toLowerCase();
  if (value === 'claude' || value === 'deterministic') return value;
  return 'openai';
}

function openAIKey(env?: NodeJS.ProcessEnv): string | null {
  return normalizeSecret(envValue('DAHCORP_SERVICE_ACCOUNT_OPENAI_KEY', env) || envValue('OPENAI_API_KEY', env));
}

function openAIAvailable(env?: NodeJS.ProcessEnv): boolean {
  return Boolean(openAIKey(env));
}

function openAIModel(env?: NodeJS.ProcessEnv): string {
  return envValue('OPENAI_MODEL', env)?.trim() || envValue('OPENAI_AGENT_MODEL', env)?.trim() || DEFAULT_OPENAI_MODEL;
}

function openAIPromptId(env?: NodeJS.ProcessEnv): string {
  // OPEN_AI_PROMPT_ID is retained as a compatibility alias for the original
  // Netlify variable name used during the Prompt-ID rollout.
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

function openAIResponsesEndpoint(env?: NodeJS.ProcessEnv): string {
  return openAIEndpoint('responses', env);
}

function openAIMeEndpoint(env?: NodeJS.ProcessEnv): string {
  return openAIEndpoint('me', env);
}

function promptValue(value: unknown): string {
  if (value == null) return JSON.stringify({ status: 'not_available' });
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function openAIRuntimeTreasuryInput(request: AgentRequest): string {
  const { question, digest, capital, config, shadowEvidence, eventIntelligence, claudeResearchBrief, dataProvenance } = request;
  return [
    '══════════════════════════════════════',
    'RUNTIME TREASURY CONTEXT',
    '══════════════════════════════════════',
    `AS OF\n${digest.asOf}`,
    `USER QUESTION\n${question}`,
    `AVAILABLE CAPITAL\n${capital.toFixed(2)}`,
    `DATA PROVENANCE\n${promptValue(dataProvenance)}`,
    `PORTFOLIO DIGEST\n${promptValue(digest)}`,
    `STRATEGY POLICY\n${promptValue(config)}`,
    `SHADOW MODE EVIDENCE\n${promptValue(shadowEvidence)}`,
    `EVENT INTELLIGENCE\n${promptValue(eventIntelligence)}`,
    `CLAUDE RESEARCH BRIEF\n${promptValue(claudeResearchBrief)}`,
    'Treat this runtime context as the authoritative instance-specific input for the current analysis. Provenance describes evidence freshness and lineage, not execution authority. Missing fields remain UNKNOWN, never zero.',
  ].join('\n\n');
}

async function readSafeOpenAIError(response: Response): Promise<SafeOpenAIError> {
  try {
    return safeOpenAIErrorFromPayload(await response.json());
  } catch {
    return { type: null, code: null, param: null };
  }
}

async function probeOpenAIIdentity(apiKey: string): Promise<OpenAIIdentityProbe> {
  try {
    const response = await fetch(openAIMeEndpoint(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    if (response.ok) {
      return { status: response.status, authenticated: true, error: { type: null, code: null, param: null } };
    }
    return {
      status: response.status,
      authenticated: response.status === 401 ? false : null,
      error: await readSafeOpenAIError(response),
    };
  } catch {
    return { status: null, authenticated: null, error: { type: null, code: null, param: null } };
  }
}

function identityProbeDiagnostic(probe: OpenAIIdentityProbe): string {
  const providerDiagnostic = openAIErrorDiagnostic(probe.error);
  if (probe.authenticated === true) {
    return 'Credential probe: the same key authenticated successfully at OpenAI /v1/me, so the 401 is specific to the Responses request or its project/resource context.';
  }
  if (probe.authenticated === false) {
    return `Credential probe: the same key also received HTTP 401 from OpenAI /v1/me${providerDiagnostic ? ` (${providerDiagnostic})` : ''}. The credential is being rejected at the authentication boundary before the Treasury prompt or model request is evaluated.`;
  }
  if (probe.status != null) {
    return `Credential probe: OpenAI /v1/me returned HTTP ${probe.status}${providerDiagnostic ? ` (${providerDiagnostic})` : ''}, so authentication could not be conclusively isolated.`;
  }
  return 'Credential probe: OpenAI /v1/me could not be completed, so authentication could not be independently verified.';
}

function safeOpenAIFailure(status: number, providerError: SafeOpenAIError, identityProbe?: OpenAIIdentityProbe): string {
  const diagnostic = openAIErrorDiagnostic(providerError);
  const suffix = diagnostic ? ` OpenAI error: ${diagnostic}.` : '';
  if (status === 401) {
    const probe = identityProbe ? ` ${identityProbeDiagnostic(identityProbe)}` : '';
    return `OpenAI rejected the Treasury Responses request (HTTP 401).${suffix}${probe} The deterministic strategy brief is shown instead.`;
  }
  if (status === 403) return `OpenAI authenticated the credential but denied access to the requested resource or model (HTTP 403).${suffix}`;
  if (status === 404) return `OpenAI authenticated the request but could not find the configured model or stored prompt (HTTP 404).${suffix}`;
  if (status === 429) return `OpenAI rate or project-spend limits prevented this request (HTTP 429).${suffix}`;
  if (status >= 500) return `OpenAI is temporarily unavailable (HTTP ${status}).${suffix} The deterministic strategy brief is shown instead.`;
  return `The OpenAI request was rejected with HTTP ${status}.${suffix} The deterministic strategy brief is shown instead.`;
}

async function requestOpenAIRecommendation(request: AgentRequest): Promise<AgentResult> {
  const { deterministicBrief } = request;
  const apiKey = openAIKey();

  if (!apiKey) {
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model: null,
      fallbackReason: 'OpenAI credentials are not present in this runtime. The deterministic strategy brief was used instead.',
      usage: null,
    };
  }

  const model = openAIModel();
  const promptId = openAIPromptId();
  const promptVersion = openAIPromptVersion();

  try {
    const response = await fetch(openAIResponsesEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: {
          id: promptId,
          version: promptVersion,
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
        store: false,
      }),
    });

    if (!response.ok) {
      const providerError = await readSafeOpenAIError(response);
      const diagnostic = openAIErrorDiagnostic(providerError);
      const identityProbe = response.status === 401 ? await probeOpenAIIdentity(apiKey) : undefined;
      console.error(
        `[dahcorp] OpenAI Responses request failed with status ${response.status}${diagnostic ? ` (${diagnostic})` : ''}; identity probe status ${identityProbe?.status ?? 'not-run'}.`,
      );
      return {
        brief: deterministicBrief,
        source: 'deterministic',
        model,
        fallbackReason: safeOpenAIFailure(response.status, providerError, identityProbe),
        usage: null,
      };
    }

    const payload = (await response.json()) as OpenAIResponsesPayload;
    const call = payload.output?.find((item) => item.type === 'function_call' && item.name === RECOMMENDATION_TOOL.name);

    let parsedInput: unknown = null;
    if (call?.arguments) {
      try { parsedInput = JSON.parse(call.arguments); } catch { parsedInput = null; }
    }

    const brief = parseRecommendation(parsedInput);
    const usage = payload.usage
      ? { inputTokens: payload.usage.input_tokens ?? 0, outputTokens: payload.usage.output_tokens ?? 0 }
      : null;

    if (!brief) {
      return {
        brief: deterministicBrief,
        source: 'deterministic',
        model,
        fallbackReason: 'The OpenAI response did not match the required recommendation schema and was discarded.',
        usage,
      };
    }

    return { brief, source: 'openai', model, fallbackReason: null, usage };
  } catch (error) {
    console.error('[dahcorp] OpenAI agent request failed:', error instanceof Error ? error.message : 'unknown error');
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model,
      fallbackReason: 'The OpenAI request could not be completed. The deterministic policy recommendation is shown instead.',
      usage: null,
    };
  }
}

export async function requestAgentRecommendation(request: AgentRequest): Promise<AgentResult> {
  const provider = configuredProvider();
  if (provider === 'deterministic') {
    return {
      brief: request.deterministicBrief,
      source: 'deterministic',
      model: null,
      fallbackReason: 'DAHCorp is configured for deterministic-only analysis.',
      usage: null,
    };
  }
  if (provider === 'claude') return requestClaudeRecommendation(request);
  return requestOpenAIRecommendation(request);
}

export function agentRuntimeStatus(env?: NodeJS.ProcessEnv) {
  const provider = configuredProvider(env);
  const anthropicAvailable = Boolean(
    normalizeSecret(envValue('ANTHROPIC_WORKSPACE_KEY', env) || envValue('ANTHROPIC_API_KEY', env) || envValue('NETLIFY_AI_GATEWAY_KEY', env)),
  );
  return {
    provider,
    model: provider === 'openai'
      ? openAIModel(env)
      : provider === 'claude'
        ? envValue('CLAUDE_MODEL', env)?.trim() || 'claude-sonnet-4-6'
        : null,
    available: provider === 'openai' ? openAIAvailable(env) : provider === 'claude' ? anthropicAvailable : true,
    promptId: provider === 'openai' ? openAIPromptId(env) : null,
    promptVersion: provider === 'openai' ? openAIPromptVersion(env) : null,
    recurringShadowUsesModel: false,
  };
}
