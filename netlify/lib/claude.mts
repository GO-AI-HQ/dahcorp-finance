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
      fallbackReason: 'The Claude request failed. Showing the deterministic policy recommendation instead.',
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
 * Claude is a research analyst, not an execution authority. This call is used
 * only for material event/modeling work so scheduled intelligence collection
 * does not burn model tokens continuously.
 */
export async function requestResearchBrief(input: {
  question: string;
  digest: AgentDigest;
  eventIntelligence?: unknown;
}): Promise<ClaudeResearchBrief> {
  const anthropic = client();
  if (!anthropic) return { available: false, model: null, text: 'Claude research unavailable in this runtime.', usage: null };
  const model = resolveModel();
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1400,
      system: [
        'You are the DAHCorp Finance Research Analyst.',
        'Your job is to analyze supplied filings, policy/news/event evidence and portfolio context, not to place or authorize trades.',
        'Separate verified facts from interpretation. Call out information latency, contradictory evidence and missing data.',
        'Explain the consequence for the stated treasury objective in plain English.',
        'Do not invent prices, historical outcomes, filings or facts not supplied.',
        'Return a concise research brief that another model can use as evidence.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: [
          `QUESTION\n${input.question}`,
          `PORTFOLIO / STRATEGY DIGEST\n${JSON.stringify(input.digest)}`,
          `EVENT INTELLIGENCE\n${JSON.stringify(input.eventIntelligence ?? { status: 'not_available' })}`,
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
