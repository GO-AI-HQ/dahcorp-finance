import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildPlan, buildSignalsPayload, investableCapital } from '../../src/services/analysis.js';
import { buildAgentDigest } from '../../src/agent/digest.js';
import { buildDeterministicBrief, buildSemanticModelUnavailableBrief, requiresSemanticModel } from '../../src/agent/fallback.js';
import { STANDING_QUESTIONS } from '../../src/agent/prompt.js';
import { requestAgentRecommendation } from '../lib/agentModel.mts';
import { validateAllocation, validateOrders } from '../../src/risk/engine.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import { recordAudit, saveRecommendation } from '../lib/store.mts';
import type { ProposedOrder } from '../../src/risk/types.js';

export default withErrorHandling('analyze', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;
  const body = await readJsonBody<{ question?: string; capital?: number }>(req);
  const question = (body?.question ?? STANDING_QUESTIONS[0]).toString().slice(0, 600).trim();
  if (!question) return fail(400, 'MISSING_QUESTION', 'A question is required.');

  const ctx = await buildServerContext();
  const signals = buildSignalsPayload(ctx);
  const policyCapital = investableCapital(ctx);
  const requested = typeof body?.capital === 'number' && Number.isFinite(body.capital) ? body.capital : policyCapital;
  const capital = Math.max(0, Math.min(requested, policyCapital));
  const plan = buildPlan(ctx, capital);
  const digest = buildAgentDigest({ ctx, plan, opportunities: signals.opportunities, semis: signals.semis, drag: signals.drag, capital });
  const deterministicBrief = requiresSemanticModel(question)
    ? buildSemanticModelUnavailableBrief(question, capital)
    : buildDeterministicBrief({ ctx, plan, opportunities: signals.opportunities, semis: signals.semis, drag: signals.drag, question });
  const agent = await requestAgentRecommendation({ question, digest, capital, config: ctx.config, deterministicBrief });

  const riskContext = { asOf: ctx.snapshot.asOf, analysis: ctx.analysis, income: ctx.income, quotes: ctx.snapshot.quotes, config: ctx.config };
  const orders: ProposedOrder[] = [...agent.brief.legs]
    .sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1))
    .map((leg, index) => {
      const account = ctx.analysis.accounts.find((row) => row.account.id === leg.accountId)?.account;
      return {
        id: `agent-${index}-${leg.symbol}`,
        accountId: leg.accountId,
        broker: account?.broker ?? 'manual',
        symbol: leg.symbol,
        side: leg.side ?? 'buy',
        notional: leg.amount,
        orderType: 'market',
        rationale: leg.reason,
        origin: 'agent',
        fundingSource: leg.side === 'sell' ? undefined : 'broker_cash',
        sleeve: getInstrumentOrFallback(leg.symbol).sleeve,
      };
    });
  const riskDecision = validateOrders(orders, riskContext);
  const baselineDecision = validateAllocation(plan.legs.map((leg) => ({ symbol: leg.symbol, amount: leg.amount, accountId: leg.accountId, sleeve: leg.sleeve })), riskContext);

  const recommendationId = await saveRecommendation({ question, availableCapital: capital, source: agent.source, model: agent.model, headline: agent.brief.headline, confidence: agent.brief.confidence, brief: agent.brief, portfolioSnapshot: digest, deterministicOutcome: { plan, riskDecision, baselineDecision } });
  const sourceLabel = agent.source === 'openai' ? `OpenAI (${agent.model})` : agent.source === 'claude' ? `Claude (${agent.model})` : 'Deterministic policy';
  await recordAudit({ category: 'agent', action: 'analyze', severity: riskDecision.approved ? 'info' : 'warning', message: `${sourceLabel}: ${agent.brief.headline}`, detail: { recommendationId, question, capital, source: agent.source, model: agent.model, riskApproved: riskDecision.approved, blockedCodes: riskDecision.orders.flatMap((o) => o.findings).filter((f) => f.severity === 'block').map((f) => f.code), fallbackReason: agent.fallbackReason } });

  return json({ asOf: ctx.snapshot.asOf, containsMockData: ctx.snapshot.containsMockData, sourceNotes: ctx.snapshot.sourceNotes, recommendationId, question, standingQuestions: STANDING_QUESTIONS, capital, brief: agent.brief, source: agent.source, model: agent.model, fallbackReason: agent.fallbackReason, usage: agent.usage, riskDecision, baseline: { plan, riskDecision: baselineDecision }, executionEnabled: false, phaseNote: 'Analysis is advisory. Live execution remains governed by broker-specific preview, confirmation and reconciliation.' });
});
