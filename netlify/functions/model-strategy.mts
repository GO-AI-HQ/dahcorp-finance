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
import { buildMarketIntelligencePayload } from '../lib/intelligenceEngine.mts';
import { loadStableAdvancedEvidenceFabric } from '../lib/intelligenceV3Stable.mts';
import { compactAdvancedEvidence } from '../lib/intelligenceContext.mts';
import { buildStrategyMutationProposals, loadIncomeIntelligence } from '../lib/incomeIntelligence.mts';
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
    headline: 'Keep the available cash where it is until the evidence supports a specific move.',
    confidence: 'low',
    thesis: `Modeling Lab could not establish a sufficiently supported change for "${question}". Keeping ${capital.toFixed(2)} available is better than manufacturing a trade.`,
    legs: [],
    risks: ['Acting on incomplete information could create an unnecessary transaction.'],
    alternative: null,
    etaImpact: 'No modeled change to the goal until a well-supported option is available.',
    notes: ['Doing nothing with the cash is a valid decision.'],
    dataCaveats: ['Some model or research information may be unavailable.'],
  };
}

function incomeRate(symbol: string, ctx: Awaited<ReturnType<typeof buildServerContext>>, opportunities: ReturnType<typeof buildSignalsPayload>['opportunities']): number | null {
  const held = ctx.income.positions.find((position) => position.symbol === symbol)?.distributionRate;
  if (held != null) return held;
  const candidate = opportunities.find((row) => row.symbol === symbol)?.efficiency.forwardRate;
  return candidate ?? null;
}

function shouldAskClaude(question: string, hasAttachedEvent: boolean, researchCoverage: number, hasIncomeResearch: boolean): boolean {
  if (hasAttachedEvent) return true;
  if (hasIncomeResearch && /income|yield|dividend|rotate|rotation|replace|reweight|shipping|fund|etf/i.test(question)) return true;
  if (researchCoverage <= 0) return false;
  return /compare|research|income|yield|dividend|fund|etf|overlap|earnings|options|shipping|energy|semiconductor|chip|savings|cash|rate|rotate|rotation|risk|macro|why/i.test(question);
}

export default withErrorHandling('model-strategy', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;
  const body = await readJsonBody<{ question?: string; eventFingerprint?: string; capital?: number; horizonMonths?: number }>(req);
  const question = String(body?.question ?? 'What is the best use of the relevant strategy cash right now?').slice(0, 900).trim();
  if (!question) return fail(400, 'MISSING_QUESTION', 'A Modeling Lab question is required.');

  const [ctx, intelligence, advanced, incomeResearch] = await Promise.all([
    buildServerContext(),
    buildMarketIntelligencePayload({ refresh: false, limit: 120 }),
    loadStableAdvancedEvidenceFabric(),
    loadIncomeIntelligence(),
  ]);
  const signals = buildSignalsPayload(ctx);
  const event = body?.eventFingerprint
    ? intelligence.events.find((row) => row.fingerprint === body.eventFingerprint) ?? null
    : null;
  const accounts = mandateAccounts(ctx, event?.sector ?? null, question);
  const mandateCash = accounts.reduce((sum, account) => sum + Math.max(0, account.cash), 0);
  const requested = typeof body?.capital === 'number' && Number.isFinite(body.capital) ? body.capital : mandateCash;
  const capital = Math.max(0, Math.min(requested, mandateCash));

  const plan = buildPlan(ctx, capital);
  const digest = buildAgentDigest({ ctx, plan, opportunities: signals.opportunities, semis: signals.semis, drag: signals.drag, capital });
  const fallback = event ? holdBrief(question, capital) : buildDeterministicBrief({ ctx, plan, opportunities: signals.opportunities, semis: signals.semis, drag: signals.drag, question });
  const researchContext = {
    attachedEvent: event,
    market: {
      asOf: intelligence.asOf,
      providers: intelligence.providers,
      pulses: intelligence.pulses,
      marketPulse: intelligence.marketPulse,
      macroRegime: intelligence.macroRegime,
      economicCalendar: intelligence.economicCalendar.slice(0, 24),
      capitalSignals: intelligence.capitalSignals.slice(0, 20),
      policyEvents: intelligence.policyEvents.slice(0, 20),
      events: intelligence.events.slice(0, 60),
    },
    deeperResearch: compactAdvancedEvidence(advanced),
    incomeResearch: incomeResearch ? {
      asOf: incomeResearch.asOf,
      sourceStatus: incomeResearch.sourceStatus,
      upcoming: incomeResearch.upcoming.slice(0, 24),
      candidates: incomeResearch.candidates.slice(0, 16),
      strategyChangeIdeas: buildStrategyMutationProposals(ctx, incomeResearch),
      rule: 'The research universe can change automatically. The approved/executable universe cannot. Treat a new ticker as a candidate until deterministic policy and the investor approve it.',
    } : { status: 'not_available' },
  };

  // Claude is the independent research analyst, not the final decision-maker.
  // Use it when a question actually benefits from specialist research; routine
  // background refreshes never spend model tokens.
  const research = shouldAskClaude(question, Boolean(event), advanced.fusion.coveragePct, Boolean(incomeResearch))
    ? await requestResearchBrief({ question, digest, eventIntelligence: researchContext })
    : { available: false, model: null, text: 'A separate specialist research pass was not needed for this question.', usage: null };

  const agent = await requestAgentRecommendation({
    question,
    digest,
    capital,
    config: ctx.config,
    deterministicBrief: fallback,
    eventIntelligence: researchContext,
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
      manualSteps.push(`${validated.order.side.toUpperCase()} ${validated.order.symbol}: this can be sent to Robinhood for a final preview only when your confirmation settings allow it.`);
    } else if (account.broker === 'schwab' && validated.order.side === 'buy' && validated.order.symbol === 'YMAG') {
      manualSteps.push(`BUY YMAG: this can be sent to Schwab 3085 for a whole-share preview when enough cash is available and your confirmation settings allow it.`);
    } else {
      manualSteps.push(`${validated.order.side.toUpperCase()} ${validated.order.symbol}: this can be saved as part of the plan, but this broker/symbol combination still requires either a supported broker connection or a manual trade.`);
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
      researchCoverage: advanced.fusion,
      incomeResearchAsOf: incomeResearch?.asOf ?? null,
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
      ? 'This proposal does not immediately change modeled investment income. Judge a Growth or Maritime move by entry quality, exposure and the long-term plan rather than pretending it creates income today.'
      : 'The proposed model uses the post-change income capital and modeled distribution rate. It is a scenario, not a forecast.',
  });
});
