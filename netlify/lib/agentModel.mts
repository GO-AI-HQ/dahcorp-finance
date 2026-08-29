import { buildSystemPrompt, buildUserPrompt } from '../../src/agent/prompt.js';
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
  /** Returned verbatim when the selected model cannot be reached or fails validation. */
  deterministicBrief: RecommendationBrief;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';

function configuredProvider(env: NodeJS.ProcessEnv = process.env): AgentProvider {
  const value = env.DAHCORP_AGENT_PROVIDER?.trim().toLowerCase();
  if (value === 'claude' || value === 'deterministic') return value;
  return 'openai';
}

function openAIAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  // Netlify AI Gateway injects both variables on supported plans. A direct
  // OpenAI API key also works when OPENAI_BASE_URL is omitted.
  return Boolean(env.OPENAI_API_KEY?.trim());
}

function openAIModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENAI_AGENT_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

function openAIChatEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com').replace(/\/$/, '');
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

async function requestOpenAIRecommendation(request: AgentRequest): Promise<AgentResult> {
  const { question, digest, capital, config, deterministicBrief } = request;
  if (!openAIAvailable()) {
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model: null,
      fallbackReason: 'OpenAI credentials are not present in this runtime. The deterministic strategy brief was used instead.',
      usage: null,
    };
  }

  const model = openAIModel();
  try {
    const response = await fetch(openAIChatEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(config) },
          { role: 'user', content: buildUserPrompt({ question, digest, capital }) },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: RECOMMENDATION_TOOL.name,
              description: RECOMMENDATION_TOOL.description,
              parameters: RECOMMENDATION_TOOL.input_schema,
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: RECOMMENDATION_TOOL.name },
        },
      }),
    });

    if (!response.ok) {
      // Never log the response body: providers can echo request metadata. Status
      // is enough for operations while preserving the portfolio prompt boundary.
      console.error(`[dahcorp] OpenAI agent request failed with status ${response.status}.`);
      return {
        brief: deterministicBrief,
        source: 'deterministic',
        model,
        fallbackReason: `The OpenAI request failed with status ${response.status}. The deterministic policy recommendation is shown instead.`,
        usage: null,
      };
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    const call = payload.choices?.[0]?.message?.tool_calls?.find(
      (item) => item.function?.name === RECOMMENDATION_TOOL.name,
    );
    let parsedInput: unknown = null;
    if (call?.function?.arguments) {
      try {
        parsedInput = JSON.parse(call.function.arguments);
      } catch {
        parsedInput = null;
      }
    }
    const brief = parseRecommendation(parsedInput);
    const usage = payload.usage
      ? {
          inputTokens: payload.usage.prompt_tokens ?? 0,
          outputTokens: payload.usage.completion_tokens ?? 0,
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
 * Provider router. OpenAI is the default DAHCorp runtime so the investor does
 * not spend Anthropic credits on ordinary treasury analysis. Claude remains an
 * explicit opt-in provider for the company's broader multi-model architecture.
 * A missing provider always degrades to the deterministic brief, never to an
 * unvalidated free-form answer.
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
  return {
    provider,
    model: provider === 'openai' ? openAIModel(env) : provider === 'claude' ? env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5' : null,
    available: provider === 'openai' ? openAIAvailable(env) : provider === 'claude' ? Boolean(env.ANTHROPIC_API_KEY || env.NETLIFY_AI_GATEWAY_KEY) : true,
    recurringShadowUsesModel: false,
  };
}
