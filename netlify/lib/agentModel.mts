import { RECOMMENDATION_TOOL, parseRecommendation } from '../../src/agent/schema.js';
import type { AgentDigest } from '../../src/agent/digest.js';
import type { AgentResult, RecommendationBrief } from '../../src/agent/types.js';
import type { StrategyConfig } from '../../src/core/config.js';
import { requestRecommendation as requestClaudeRecommendation } from './claude.mts';

export type AgentProvider = 'openai' | 'claude' | 'deterministic';

export interface AgentRequest {
  question: string;
  digest: AgentDigest;
  capital: number;
  config: StrategyConfig;
  /** Optional evidence layers become prompt variables as they come online. */
  shadowEvidence?: unknown;
  eventIntelligence?: unknown;
  claudeResearchBrief?: unknown;
  /** Returned verbatim when the selected model cannot be reached or fails validation. */
  deterministicBrief: RecommendationBrief;
}

interface OpenAIResponsesPayload {
  output?: Array<{
    type?: string;
    name?: string;
    arguments?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_OPENAI_PROMPT_ID = 'pmpt_6a9286ff3dbc8190b8c15ef4da2e001b0302504ca0de38ab';
const DEFAULT_OPENAI_PROMPT_VERSION = '1';

function configuredProvider(env: NodeJS.ProcessEnv = process.env): AgentProvider {
  const value = env.DAHCORP_AGENT_PROVIDER?.trim().toLowerCase();
  if (value === 'claude' || value === 'deterministic') return value;
  return 'openai';
}

function openAIKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DAHCORP_SERVICE_ACCOUNT_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim() || null;
}

function openAIAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(openAIKey(env));
}

function openAIModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_MODEL?.trim() || env.OPENAI_AGENT_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

function openAIPromptId(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_PROMPT_ID?.trim() || DEFAULT_OPENAI_PROMPT_ID;
}

function openAIPromptVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_PROMPT_VERSION?.trim() || DEFAULT_OPENAI_PROMPT_VERSION;
}

function openAIResponsesEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com').replace(/\/$/, '');
  return base.endsWith('/v1') ? `${base}/responses` : `${base}/v1/responses`;
}

function promptValue(value: unknown): string {
  if (value == null) return JSON.stringify({ status: 'not_available' });
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function requestOpenAIRecommendation(request: AgentRequest): Promise<AgentResult> {
  const {
    question,
    digest,
    capital,
    config,
    deterministicBrief,
    shadowEvidence,
    eventIntelligence,
    claudeResearchBrief,
  } = request;
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
          variables: {
            as_of: digest.asOf,
            user_question: question,
            available_capital: capital.toFixed(2),
            portfolio_digest: promptValue(digest),
            strategy_policy: promptValue(config),
            shadow_evidence: promptValue(shadowEvidence),
            event_intelligence: promptValue(eventIntelligence),
            claude_research_brief: promptValue(claudeResearchBrief),
          },
        },
        tools: [
          {
            type: 'function',
            name: RECOMMENDATION_TOOL.name,
            description: RECOMMENDATION_TOOL.description,
            parameters: RECOMMENDATION_TOOL.input_schema,
            strict: false,
          },
        ],
        tool_choice: { type: 'function', name: RECOMMENDATION_TOOL.name },
        parallel_tool_calls: false,
        store: false,
      }),
    });

    if (!response.ok) {
      // Do not log the response body: provider errors can echo request metadata.
      console.error(`[dahcorp] OpenAI Responses request failed with status ${response.status}.`);
      return {
        brief: deterministicBrief,
        source: 'deterministic',
        model,
        fallbackReason: `The OpenAI request failed with status ${response.status}. The deterministic policy recommendation is shown instead.`,
        usage: null,
      };
    }

    const payload = (await response.json()) as OpenAIResponsesPayload;
    const call = payload.output?.find(
      (item) => item.type === 'function_call' && item.name === RECOMMENDATION_TOOL.name,
    );

    let parsedInput: unknown = null;
    if (call?.arguments) {
      try {
        parsedInput = JSON.parse(call.arguments);
      } catch {
        parsedInput = null;
      }
    }

    const brief = parseRecommendation(parsedInput);
    const usage = payload.usage
      ? {
          inputTokens: payload.usage.input_tokens ?? 0,
          outputTokens: payload.usage.output_tokens ?? 0,
        }
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

    return {
      brief,
      source: 'openai',
      model,
      fallbackReason: null,
      usage,
    };
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

/**
 * Provider router. OpenAI is the default Treasury Strategist. Claude remains a
 * separate research provider. Missing or malformed model output always degrades
 * to the deterministic brief; neither provider can widen broker authority.
 */
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

export function agentRuntimeStatus(env: NodeJS.ProcessEnv = process.env) {
  const provider = configuredProvider(env);
  const anthropicAvailable = Boolean(
    env.ANTHROPIC_WORKSPACE_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim() || env.NETLIFY_AI_GATEWAY_KEY?.trim(),
  );
  return {
    provider,
    model:
      provider === 'openai'
        ? openAIModel(env)
        : provider === 'claude'
          ? env.CLAUDE_MODEL?.trim() || 'claude-sonnet-4-6'
          : null,
    available: provider === 'openai' ? openAIAvailable(env) : provider === 'claude' ? anthropicAvailable : true,
    promptId: provider === 'openai' ? openAIPromptId(env) : null,
    promptVersion: provider === 'openai' ? openAIPromptVersion(env) : null,
    recurringShadowUsesModel: false,
  };
}
