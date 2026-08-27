/**
 * Claude client.
 *
 * Uses the Netlify AI Gateway, so no Anthropic key is stored in this repository
 * or shipped to the browser: the platform injects credentials into the function
 * runtime and the SDK picks them up. If nothing is injected, the call is skipped
 * and the deterministic brief is returned instead — the dashboard degrades to
 * "no model available", never to "no answer".
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserPrompt } from '../../src/agent/prompt.js';
import { RECOMMENDATION_TOOL, parseRecommendation } from '../../src/agent/schema.js';
import type { AgentDigest } from '../../src/agent/digest.js';
import type { AgentResult, RecommendationBrief } from '../../src/agent/types.js';
import type { StrategyConfig } from '../../src/core/config.js';

/** Models available through the gateway that make sense for this workload. */
const ALLOWED_MODELS = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-4-8']);
const DEFAULT_MODEL = 'claude-sonnet-5';

export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  const requested = env.CLAUDE_MODEL?.trim();
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  if (requested) console.warn(`[dahcorp] CLAUDE_MODEL="${requested}" is not in the allow-list; using ${DEFAULT_MODEL}.`);
  return DEFAULT_MODEL;
}

export function modelAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.NETLIFY_AI_GATEWAY_KEY);
}

export interface AgentRequest {
  question: string;
  digest: AgentDigest;
  capital: number;
  config: StrategyConfig;
  /** Returned verbatim when the model cannot be reached or fails validation. */
  deterministicBrief: RecommendationBrief;
}

export async function requestRecommendation(request: AgentRequest): Promise<AgentResult> {
  const { question, digest, capital, config, deterministicBrief } = request;

  if (!modelAvailable()) {
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model: null,
      fallbackReason:
        'No model credentials are present in this environment. Enable Netlify AI Gateway to get Claude-authored analysis.',
      usage: null,
    };
  }

  const model = resolveModel();
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      system: buildSystemPrompt(config),
      tools: [RECOMMENDATION_TOOL],
      tool_choice: { type: 'tool', name: RECOMMENDATION_TOOL.name },
      messages: [{ role: 'user', content: buildUserPrompt({ question, digest, capital }) }],
    });

    const toolUse = message.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
    );
    const brief = toolUse ? parseRecommendation(toolUse.input) : null;

    if (!brief) {
      return {
        brief: deterministicBrief,
        source: 'deterministic',
        model,
        fallbackReason: 'The model response did not match the required recommendation schema and was discarded.',
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    }

    return {
      brief,
      source: 'claude',
      model,
      fallbackReason: null,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  } catch (error) {
    // The message is logged server-side only; the client sees a generic reason.
    console.error('[dahcorp] Claude request failed:', error);
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model,
      fallbackReason: 'The model request failed. Showing the deterministic policy recommendation instead.',
      usage: null,
    };
  }
}
