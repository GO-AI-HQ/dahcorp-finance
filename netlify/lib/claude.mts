import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserPrompt } from '../../src/agent/prompt.js';
import { RECOMMENDATION_TOOL, parseRecommendation } from '../../src/agent/schema.js';
import type { AgentDigest } from '../../src/agent/digest.js';
import type { AgentResult, RecommendationBrief } from '../../src/agent/types.js';
import type { StrategyConfig } from '../../src/core/config.js';

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-haiku-4-5',
  'claude-opus-4-8',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function envValue(key: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (env) return env[key];
  try { return Netlify.env.get(key) ?? undefined; } catch { return process.env[key]; }
}

function secret(env?: NodeJS.ProcessEnv): string | null {
  const raw = envValue('ANTHROPIC_WORKSPACE_KEY', env) || envValue('ANTHROPIC_API_KEY', env) || envValue('NETLIFY_AI_GATEWAY_KEY', env);
  if (!raw) return null;
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return value.replace(/^Bearer\s+/i, '').trim() || null;
}

export function resolveModel(env?: NodeJS.ProcessEnv): string {
  const requested = envValue('CLAUDE_MODEL', env)?.trim() || envValue('ANTHROPIC_MODEL', env)?.trim();
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  if (requested) console.warn(`[dahcorp] Configured Claude model is not in the DAHCorp allow-list; using ${DEFAULT_MODEL}.`);
  return DEFAULT_MODEL;
}

export function modelAvailable(env?: NodeJS.ProcessEnv): boolean {
  return Boolean(secret(env));
}

export interface AgentRequest {
  question: string;
  digest: AgentDigest;
  capital: number;
  config: StrategyConfig;
  deterministicBrief: RecommendationBrief;
}

function client(): Anthropic | null {
  const apiKey = secret();
  return apiKey ? new Anthropic({ apiKey }) : null;
}

export async function requestRecommendation(request: AgentRequest): Promise<AgentResult> {
  const { question, digest, capital, config, deterministicBrief } = request;
  const anthropic = client();
  if (!anthropic) {
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model: null,
      fallbackReason: 'Claude credentials are not present in this runtime.',
      usage: null,
    };
  }

  const model = resolveModel();
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: buildSystemPrompt(config),
      tools: [RECOMMENDATION_TOOL],
      tool_choice: { type: 'tool', name: RECOMMENDATION_TOOL.name },
      messages: [{ role: 'user', content: buildUserPrompt({ question, digest, capital }) }],
    });
    const toolUse = message.content.find((block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use');
    const brief = toolUse ? parseRecommendation(toolUse.input) : null;
    if (!brief) {
      return {
        brief: deterministicBrief,
        source: 'deterministic',
        model,
        fallbackReason: 'The Claude response did not match the required recommendation schema and was discarded.',
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    }
    return { brief, source: 'claude', model, fallbackReason: null, usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
  } catch (error) {
    console.error('[dahcorp] Claude request failed:', error instanceof Error ? error.message : 'unknown error');
    return {
      brief: deterministicBrief,
      source: 'deterministic',
      model,
      fallbackReason: 'The Claude request failed. Showing the rule-based recommendation instead.',
      usage: null,
    };
  }
}

export interface ClaudeResearchBrief {
  available: boolean;
  model: string | null;
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Claude is the independent research analyst, not the final strategist and not
 * an execution authority. It runs only when a Modeling Lab decision benefits
 * from a specialist research pass; scheduled data collection never spends
 * Claude tokens continuously.
 */
export async function requestResearchBrief(input: {
  question: string;
  digest: AgentDigest;
  eventIntelligence?: unknown;
}): Promise<ClaudeResearchBrief> {
  const anthropic = client();
  if (!anthropic) return { available: false, model: null, text: 'Claude research is unavailable in this runtime.', usage: null };
  const model = resolveModel();
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1400,
      system: [
        'You are the independent Research Analyst for DAHCorp Finance.',
        'Your job is to pressure-test the supplied portfolio, market, filings, fund, options, earnings, policy and public-disclosure evidence before the Strategist makes the final recommendation.',
        'You do not place trades, authorize trades, change safety rules or decide that money is investable.',
        'Separate verified facts from interpretation. Point out stale information, contradictory evidence and important missing data.',
        'Pay special attention to whether the evidence actually changes the user’s financial goal or whether doing nothing remains the better choice.',
        'Do not invent prices, yields, historical outcomes, filings, bank eligibility, fund holdings or facts that were not supplied.',
        'Write a concise second-opinion research brief in normal human language. Another model will use it as evidence, not as authority.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: [
          `QUESTION\n${input.question}`,
          `PORTFOLIO AND PLAN\n${JSON.stringify(input.digest)}`,
          `CURRENT RESEARCH\n${JSON.stringify(input.eventIntelligence ?? { status: 'not_available' })}`,
        ].join('\n\n'),
      }],
    });
    const text = message.content.filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('\n').trim();
    return {
      available: Boolean(text),
      model,
      text: text || 'Claude returned no usable research text.',
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  } catch (error) {
    console.error('[dahcorp] Claude research request failed:', error instanceof Error ? error.message : 'unknown error');
    return { available: false, model, text: 'Claude research was unavailable for this decision.', usage: null };
  }
}
