import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildPlan, buildSignalsPayload, investableCapital } from '../../src/services/analysis.js';
import { buildAgentDigest } from '../../src/agent/digest.js';
import { buildDeterministicBrief } from '../../src/agent/fallback.js';
import { STANDING_QUESTIONS } from '../../src/agent/prompt.js';
import { requestAgentRecommendation } from '../lib/agentModel.mts';
import { validateAllocation } from '../../src/risk/engine.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { recordAudit, saveRecommendation } from '../lib/store.mts';

/**
 * POST /.netlify/functions/analyze
 *
 * The treasury-agent endpoint, and the place where the architecture is enforced:
 *
 *   LLM → Recommendation → Deterministic Risk Engine → Investor
 *
 * A model's brief is never trusted on its own. Every proposed leg is passed
 * through `validateAllocation`, and the risk verdict travels with the brief so
 * the UI cannot display an unvalidated recommendation. The deterministic engine
 * reads the portfolio and stored policy independently — model prose cannot
 * change risk ceilings or grant execution authority.
 */
export default withErrorHandling('analyze', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = await readJsonBody<{ question?: string; capital?: number }>(req);
  const question = (body?.question ?? STANDING_QUESTIONS[0]).toString().slice(0, 600).trim();
  if (!question) return fail(400, 'MISSING_QUESTION', 'A question is required.');

  const ctx = await buildServerContext();
  const signals = buildSignalsPayload(ctx);

  // Capital is bounded by deterministic policy, not by the request or the LLM.
  const policyCapital = investableCapital(ctx);
  const requested = typeof body?.capital === 'number' && Number.isFinite(body.capital) ? body.capital : policyCapital;
  const capital = Math.max(0, Math.min(requested, policyCapital));

  const plan = buildPlan(ctx, capital);
  const digest = buildAgentDigest({
    ctx,
    plan,
    opportunities: signals.opportunities,
    semis: signals.semis,
    drag: signals.drag,
    capital,
  });
  const deterministicBrief = buildDeterministicBrief({
    ctx,
    plan,
    opportunities: signals.opportunities,
    semis: signals.semis,
    drag: signals.drag,
    question,
  });

  const agent = await requestAgentRecommendation({
    question,
    digest,
    capital,
    config: ctx.config,
    deterministicBrief,
  });

  const riskContext = {
    asOf: ctx.snapshot.asOf,
    analysis: ctx.analysis,
    income: ctx.income,
    quotes: ctx.snapshot.quotes,
    config: ctx.config,
  };
  const riskDecision = validateAllocation(
    agent.brief.legs.map((leg) => ({
      symbol: leg.symbol,
      amount: leg.amount,
      accountId: leg.accountId,
      sleeve: getInstrumentOrFallback(leg.symbol).sleeve,
    })),
    riskContext,
  );
  const baselineDecision = validateAllocation(
    plan.legs.map((leg) => ({
      symbol: leg.symbol,
      amount: leg.amount,
      accountId: leg.accountId,
      sleeve: leg.sleeve,
    })),
    riskContext,
  );

  const recommendationId = await saveRecommendation({
    question,
    availableCapital: capital,
    source: agent.source,
    model: agent.model,
    headline: agent.brief.headline,
    confidence: agent.brief.confidence,
    brief: agent.brief,
    portfolioSnapshot: digest,
    deterministicOutcome: { plan, riskDecision, baselineDecision },
  });

  const sourceLabel =
    agent.source === 'openai'
      ? `OpenAI (${agent.model})`
      : agent.source === 'claude'
        ? `Claude (${agent.model})`
        : 'Deterministic policy';
  await recordAudit({
    category: 'agent',
    action: 'analyze',
    severity: riskDecision.approved ? 'info' : 'warning',
    message: `${sourceLabel}: ${agent.brief.headline}`,
    detail: {
      recommendationId,
      question,
      capital,
      source: agent.source,
      model: agent.model,
      riskApproved: riskDecision.approved,
      blockedCodes: riskDecision.orders
        .flatMap((o) => o.findings)
        .filter((f) => f.severity === 'block')
        .map((f) => f.code),
      fallbackReason: agent.fallbackReason,
    },
  });

  return json({
    asOf: ctx.snapshot.asOf,
    containsMockData: ctx.snapshot.containsMockData,
    sourceNotes: ctx.snapshot.sourceNotes,
    recommendationId,
    question,
    standingQuestions: STANDING_QUESTIONS,
    capital,
    brief: agent.brief,
    source: agent.source,
    model: agent.model,
    fallbackReason: agent.fallbackReason,
    usage: agent.usage,
    /** The deterministic verdict on model-proposed legs. Never omitted. */
    riskDecision,
    /** The deterministic policy plan, for side-by-side comparison. */
    baseline: { plan, riskDecision: baselineDecision },
    executionEnabled: false,
    phaseNote: 'Analysis is advisory. Agentic execution remains governed by separate Shadow/Confirm policy and broker-specific risk gates.',
  });
});
