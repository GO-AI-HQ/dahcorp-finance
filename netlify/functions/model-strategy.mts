import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildPlan, buildSignalsPayload, buildSimulation } from '../../src/services/analysis.js';
import { buildAgentDigest } from '../../src/agent/digest.js';
import { buildDeterministicBrief } from '../../src/agent/fallback.js';
import { requestAgentRecommendation } from '../lib/agentModel.mts';
import { requestResearchBrief } from '../lib/claude.mts';
import { validateOrders } from '../../src/risk/engine.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import type { ProposedOrder } from '../../src/risk/types.js';
import type { RecommendationBrief } from '../../src/agent/types.js';
import { recentIntelligenceEvents } from '../lib/intelligenceStore.mts';
import { saveRecommendation } from '../lib/store.mts';

function mandateAccounts(ctx: Awaited<ReturnType<typeof buildServerContext>>, sector: string | null, question: string) {
  const incomeQuestion = /income|ymag|ymax|amzy|msfo|qqqi|dividend|cash.flow/i.test(question);
  if (incomeQuestion) return ctx.analysis.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Income')).map((row) => row.account);
  if (sector === 'shipping') return ctx.analysis.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Maritime')).map((row) => row.account);
  if (sector === 'semiconductors' || sector === 'energy' || sector === 'technology') return ctx.analysis.accounts.filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible).map((row) => row.account);
  return ctx.analysis.accounts.filter((row) => row.account.allocationEligible).map((row) => row.account);
}

function holdBrief(question: string, capital: number): RecommendationBrief {
  return {
    headline: 'Hold the available cash until the evidence can support a specific move.',
    confidence: 'low',
    thesis: `The Modeling Lab could not establish a sufficiently supported reallocation for "${question}". Preserving ${capital.toFixed(2)} of available mandate cash is preferable to manufacturing a trade.`,
    legs: [],
    risks: ['Acting without a validated model/research brief could convert incomplete evidence into an unnecessary transaction.'],
    alternative: null,
    etaImpact: 'No modeled change to the goal until a supported strategy is available.',
    notes: ['Holding cash is an active strategy decision.'],
    dataCaveats: ['The model layer or required evidence may be unavailable.'],
  };
}

function incomeRate(symbol: string, ctx: Awaited<ReturnType<typeof buildServerContext>>, opportunities: ReturnType<typeof buildSignalsPayload>['opportunities']): number | null {
  const held = ctx.income.positions.find((position) => position.symbol === symbol)?.distributionRate;
  if (held != null) return held;
  const candidate = opportunities.find((row) => row.symbol === symbol)?.efficiency.forwardRate;
  return candidate ?? null;
}

export default withErrorHandling('model-strategy', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;
  const body = await readJsonBody<{ question?: string; eventFingerprint?: string; capital?: number; horizonMonths?: number }>(req);
  const question = String(body?.question ?? 'What is the best use of the relevant strategy cash right now?').slice(0, 900).trim();
  if (!question) return fail(400, 'MISSING_QUESTION', 'A Modeling Lab question is required.');

  const ctx = await buildServerContext();
  const signals = buildSignalsPayload(ctx);
  const storedEvents = body?.eventFingerprint ? await recentIntelligenceEvents(250) : [];
  const event = body?.eventFingerprint ? storedEvents.find((row) => row.fingerprint === body.eventFingerprint) ?? null : null;
  const accounts = mandateAccounts(ctx, event?.sector ?? null, question);
  const mandateCash = accounts.reduce((sum, account) => sum + Math.max(0, account.cash), 0);
  const requested = typeof body?.capital === 'number' && Number.isFinite(body.capital) ? body.capital : mandateCash;
  const capital = Math.max(0, Math.min(requested, mandateCash));

  const plan = buildPlan(ctx, capital);
  const digest = buildAgentDigest({ ctx, plan, opportunities: signals.opportunities, semis: signals.semis, drag: signals.drag, capital });
  const fallback = event ? holdBrief(question, capital) : buildDeterministicBrief({ ctx, plan, opportunities: signals.opportunities, semis: signals.semis, drag: signals.drag, question });
  const research = event
    ? await requestResearchBrief({ question, digest, eventIntelligence: event })
    : { available: false, model: null, text: 'No material source event was attached to this model.', usage: null };
  const agent = await requestAgentRecommendation({
    question,
    digest,
    capital,
    config: ctx.config,
    deterministicBrief: fallback,
    eventIntelligence: event ?? { status: 'not_attached' },
    claudeResearchBrief: research.available ? research.text : { status: 'not_available' },
  });

  const permittedAccounts = new Set(accounts.map((account) => account.id));
  const proposedOrders: ProposedOrder[] = [...agent.brief.legs]
    .filter((leg) => permittedAccounts.has(leg.accountId))
    .sort((a, b) => (a.side === 'sell' ? -1 : 1) - (b.side === 'sell' ? -1 : 1))
    .map((leg, index) => {
      const account = accounts.find((row) => row.id === leg.accountId)!;
      return {
        id: `model-${index}-${leg.symbol}`,
        accountId: leg.accountId,
        broker: account.broker,
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
  const riskDecision = validateOrders(proposedOrders, { asOf: ctx.snapshot.asOf, analysis: ctx.analysis, income: ctx.income, quotes: ctx.snapshot.quotes, config: ctx.config });

  let monthlyIncomeDelta = 0;
  let incomeCapitalDelta = 0;
  for (const validated of riskDecision.orders) {
    if (!validated.approved || validated.allowedNotional <= 0) continue;
    const instrument = getInstrumentOrFallback(validated.order.symbol);
    if (instrument.sleeve !== 'income_engine') continue;
    const rate = incomeRate(validated.order.symbol, ctx, signals.opportunities);
    if (rate == null) continue;
    const sign = validated.order.side === 'sell' ? -1 : 1;
    incomeCapitalDelta += sign * validated.allowedNotional;
    monthlyIncomeDelta += sign * validated.allowedNotional * rate / 12;
  }

  const proposedIncomeCapital = Math.max(0, ctx.income.incomeEngineCapital + incomeCapitalDelta);
  const proposedMonthlyIncome = Math.max(0, ctx.income.forwardMonthlyIncome + monthlyIncomeDelta);
  const proposedRate = proposedIncomeCapital > 0 ? proposedMonthlyIncome * 12 / proposedIncomeCapital : (ctx.income.blendedDistributionRate ?? 0);
  const modeled = buildSimulation(ctx, {
    horizonMonths: body?.horizonMonths,
    basisOverrideRate: proposedRate,
    startingIncomeCapitalOverride: proposedIncomeCapital,
  });

  const manualSteps: string[] = [];
  for (const validated of riskDecision.orders.filter((row) => row.approved)) {
    const account = accounts.find((row) => row.id === validated.order.accountId);
    if (!account) continue;
    if (account.broker === 'robinhood') {
      manualSteps.push(`${validated.order.side.toUpperCase()} ${validated.order.symbol}: DAHCorp can route this to the Robinhood guarded preview when human-confirmed execution is armed.`);
    } else if (account.broker === 'schwab' && validated.order.side === 'buy' && validated.order.symbol === 'YMAG') {
      manualSteps.push(`BUY YMAG: DAHCorp can route this to Schwab 3085's guarded whole-share preview when sufficient cash is available.`);
    } else {
      manualSteps.push(`${validated.order.side.toUpperCase()} ${validated.order.symbol}: the strategy can be adopted and staged in DAHCorp, but this broker/symbol leg still requires a supported live execution adapter or manual broker action.`);
    }
  }

  const recommendationId = await saveRecommendation({
    question,
    availableCapital: capital,
    source: agent.source,
    model: agent.model,
    headline: agent.brief.headline,
    confidence: agent.brief.confidence,
    brief: agent.brief,
    portfolioSnapshot: digest,
    deterministicOutcome: {
      riskDecision,
      sourceEventFingerprint: event?.fingerprint ?? null,
      claudeResearch: { available: research.available, model: research.model, text: research.text },
      modelingImpact: { currentMonthlyIncome: ctx.income.forwardMonthlyIncome, proposedMonthlyIncome, monthlyIncomeDelta, currentIncomeCapital: ctx.income.incomeEngineCapital, proposedIncomeCapital, proposedRate },
    },
  });

  return json({
    asOf: ctx.snapshot.asOf,
    recommendationId,
    event,
    capital,
    mandateAccounts: accounts.map((account) => ({ id: account.id, name: account.name, broker: account.broker, cash: account.cash, role: account.role })),
    research,
    source: agent.source,
    model: agent.model,
    fallbackReason: agent.fallbackReason,
    brief: agent.brief,
    riskDecision,
    impact: {
      currentMonthlyIncome: ctx.income.forwardMonthlyIncome,
      proposedMonthlyIncome,
      monthlyIncomeDelta,
      currentIncomeCapital: ctx.income.incomeEngineCapital,
      proposedIncomeCapital,
      proposedRate,
      cashRemaining: Math.max(0, capital - riskDecision.allowedTotal),
      immediateIncomeEffectKnown: incomeCapitalDelta !== 0,
    },
    proposedProjection: modeled.projection,
    manualSteps,
    note: incomeCapitalDelta === 0
      ? 'This proposal does not immediately change modeled investment income. Its Growth/Maritime benefit should be judged by exposure, entry quality and eventual capital recycling rather than pretending it creates income today.'
      : 'The Proposed Model line uses the post-strategy income capital and modeled distribution rate. It is a scenario, not a forecast.',
  });
});
