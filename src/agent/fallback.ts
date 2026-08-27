/**
 * Deterministic recommendation brief.
 *
 * Used when no model is reachable, when the model's response fails validation,
 * and as the seeded example in mock mode. It is built entirely from the
 * deterministic allocation plan, so the dashboard always has a defensible,
 * explainable answer to "where should my next dollar go?" — with or without an
 * LLM in the loop.
 */
import type { AnalysisContext } from '../services/analysis.js';
import type { AllocationPlan, OpportunityRow } from '../strategy/allocation.js';
import type { SemiconductorEngine } from '../core/semiconductor.js';
import { activeMilestone } from '../core/config.js';
import type { AgentResult, RecommendationBrief, RecommendedLeg } from './types.js';

export function buildDeterministicBrief(args: {
  ctx: AnalysisContext;
  plan: AllocationPlan;
  opportunities: OpportunityRow[];
  semis: SemiconductorEngine;
  drag: { severity: string; title: string; detail: string }[];
  question: string;
}): RecommendationBrief {
  const { ctx, plan, opportunities, semis, drag } = args;
  const { config, income, analysis } = ctx;
  const milestone = activeMilestone(config);

  const legs: RecommendedLeg[] = plan.legs.map((leg) => ({
    symbol: leg.symbol,
    amount: leg.amount,
    accountId: leg.accountId,
    reason: leg.reason,
  }));

  const headline = legs.length
    ? `Direct $${plan.legs.reduce((a, l) => a + l.amount, 0).toFixed(2)} to ${legs.map((l) => l.symbol).join(' + ')}.`
    : plan.reserved > 0
      ? 'Hold available cash. No allocation clears the policy thresholds right now.'
      : 'No capital is available to allocate.';

  const risks: string[] = [];
  for (const d of drag.filter((d) => d.severity === 'high').slice(0, 3)) risks.push(`${d.title}: ${d.detail}`);
  if (income.flags.length) risks.push(`Income-quality flags in effect: ${income.flags.join('; ')}.`);
  if (analysis.leveragedPct > config.maxLeveragedSleevePct * 0.8) {
    risks.push(
      `Leveraged sleeve is at ${(analysis.leveragedPct * 100).toFixed(1)}% against a ${(config.maxLeveragedSleevePct * 100).toFixed(0)}% ceiling.`,
    );
  }
  const armedHarvest = semis.tactical.filter((t) => t.harvest.armedLive);
  if (armedHarvest.length) {
    risks.push(`Harvest rule armed on ${armedHarvest.map((t) => t.symbol).join(', ')} — review before adding leverage.`);
  }
  if (!risks.length) risks.push('No high-severity portfolio drag detected at this snapshot.');

  // The alternative is the next-best efficiency candidate not already funded.
  const funded = new Set(legs.map((l) => l.symbol));
  const alternativeCandidate = opportunities.find(
    (o) => !funded.has(o.symbol) && o.verdict === 'consider_adding' && !o.efficiency.stats.thinHistory,
  );
  const totalAmount = legs.reduce((a, l) => a + l.amount, 0);
  const alternative =
    alternativeCandidate && totalAmount > 0
      ? {
          summary: `Concentrate the same $${totalAmount.toFixed(2)} in ${alternativeCandidate.symbol} instead.`,
          legs: [
            {
              symbol: alternativeCandidate.symbol,
              amount: totalAmount,
              accountId: legs[0]?.accountId ?? '',
              reason: alternativeCandidate.verdictReason,
            },
          ],
          tradeoff:
            'Higher cash-flow efficiency in one name, at the cost of more single-position and single-exposure concentration.',
        }
      : null;

  const gap = milestone.monthlyIncome - income.forwardMonthlyIncome;
  const monthlyRate = (income.blendedDistributionRate ?? 0) / 12;
  const addedIncome = totalAmount * monthlyRate;
  const etaImpact =
    totalAmount > 0 && monthlyRate > 0
      ? `Adds roughly $${addedIncome.toFixed(2)}/month of modeled income, closing about ${((addedIncome / Math.max(gap, 0.01)) * 100).toFixed(1)}% of the remaining gap to ${milestone.label}.`
      : 'No measurable change to the milestone ETA from this decision.';

  return {
    headline,
    confidence: 'medium',
    thesis: plan.reasoning.join(' '),
    legs,
    risks,
    alternative,
    etaImpact,
    notes: [
      ...plan.constraints,
      'This brief was produced by the deterministic allocation policy, not by a language model.',
    ],
    dataCaveats: ctx.snapshot.containsMockData
      ? ['Snapshot contains mock data. Treat this as a demonstration of the reasoning, not advice on real positions.']
      : [],
  };
}

export function deterministicResult(brief: RecommendationBrief, fallbackReason: string): AgentResult {
  return { brief, source: 'deterministic', model: null, fallbackReason, usage: null };
}
