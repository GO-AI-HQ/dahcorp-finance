import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildPlan, buildSignalsPayload, investableCapital } from '../../src/services/analysis.js';
import { buildAgentDigest } from '../../src/agent/digest.js';
import { buildDeterministicBrief } from '../../src/agent/fallback.js';
import { STANDING_QUESTIONS } from '../../src/agent/prompt.js';
import { requestRecommendation } from '../lib/claude.mts';
import { validateAllocation } from '../../src/risk/engine.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { recordAudit, saveRecommendation } from '../lib/store.mts';

/**
 * POST /.netlify/functions/analyze
 *
 * The agent endpoint, and the place where the architecture is enforced:
 *
 *   Claude → Recommendation → Deterministic Risk Engine → Trade Preview → Human
 *
 * Claude's brief is never returned on its own. Every leg it proposes is passed
 * through `validateAllocation`, and the risk verdict travels with the brief so
 * the UI cannot display an unvalidated recommendation. The engine reads the
 * portfolio and the stored config only — Claude's text cannot influence it.
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

  // Capital is bounded by the deterministic policy, not by the request. A caller
  // cannot ask the agent to consider more than the brokerages can actually
  // deploy, and the protected household reserve is never part of that figure.
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

  const agent = await requestRecommendation({
    question,
    digest,
    capital,
    config: ctx.config,
    deterministicBrief,
  });

  // ── Deterministic validation of whatever came back.
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
    // The digest is exactly what the model saw, which is what makes the record
    // auditable after the fact.
    portfolioSnapshot: digest,
    deterministicOutcome: { plan, riskDecision, baselineDecision },
  });

  await recordAudit({
    category: 'agent',
    action: 'analyze',
    severity: riskDecision.approved ? 'info' : 'warning',
    message: `${agent.source === 'claude' ? `Claude (${agent.model})` : 'Deterministic policy'}: ${agent.brief.headline}`,
    detail: {
      recommendationId,
      question,
      capital,
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
    /** The deterministic verdict on Claude's legs. Never omitted. */
    riskDecision,
    /** The policy's own plan, for side-by-side comparison. */
    baseline: { plan, riskDecision: baselineDecision },
    executionEnabled: false,
    phaseNote: 'Phase 1: analysis only. No order can be placed through this system.',
  });
});
