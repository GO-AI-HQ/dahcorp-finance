import type { PortfolioSnapshot, Quote } from '../core/types.js';
import type { StrategyConfig } from '../core/config.js';
import { activeMilestone, strategyLevelFor } from '../core/config.js';
import { safeDiv, simpleReturns } from '../core/math.js';
import { INCOME_UNIVERSE, getInstrumentOrFallback } from '../core/universe.js';
import { exposureWeights, type PortfolioAnalysis } from '../core/portfolio.js';
import { riskScopeFor } from '../core/scope.js';
import type { IncomeSummary } from '../core/income.js';
import { computeCashFlowEfficiency, rankIncomeCandidates, type CashFlowEfficiency } from '../core/cashflowEfficiency.js';
import type { SemiconductorEngine } from '../core/semiconductor.js';

/**
 * Deterministic allocation planner.
 *
 * This produces the baseline "where should the next dollar go" answer from
 * rules and scores alone, with no language model involved. Claude's job is to
 * argue with this baseline and explain itself; the risk engine then arbitrates.
 *
 * Having a deterministic baseline is what makes the audit log meaningful — it
 * gives every Claude recommendation something to be measured against.
 */
export interface AllocationLeg {
  symbol: string;
  amount: number;
  accountId: string;
  accountName: string;
  sleeve: ReturnType<typeof getInstrumentOrFallback>['sleeve'];
  /** Why this leg, in one sentence. */
  reason: string;
  efficiencyScore: number | null;
}

export interface AllocationPlan {
  availableCapital: number;
  legs: AllocationLeg[];
  /** Capital deliberately left uninvested. */
  reserved: number;
  reservedReason: string | null;
  /** Ranked income candidates behind the decision. */
  rankedIncome: CashFlowEfficiency[];
  /** Ordered list of the deterministic reasons behind the plan. */
  reasoning: string[];
  /** Constraints that shaped or limited the plan. */
  constraints: string[];
  strategyLevel: ReturnType<typeof strategyLevelFor>;
}

export interface OpportunityRow {
  symbol: string;
  name: string;
  held: boolean;
  efficiency: CashFlowEfficiency;
  /** Efficiency advantage over the best currently-held income position. */
  scoreDeltaVsHeld: number | null;
  verdict: 'consider_adding' | 'maintain' | 'avoid' | 'insufficient_data';
  verdictReason: string;
}

function buildEfficiencyInputs(
  symbols: string[],
  snapshot: PortfolioSnapshot,
  analysis: PortfolioAnalysis,
  config: StrategyConfig,
) {
  const holdingReturnSeries: Record<string, number[]> = {};
  for (const position of analysis.positions) {
    const bars = snapshot.priceHistory[position.symbol];
    if (bars?.length) holdingReturnSeries[position.symbol] = simpleReturns(bars.map((b) => b.close));
  }
  // Overlap is judged against the capital the recommendation would actually
  // land in, so a Roth position does not penalise a taxable candidate.
  const weights = exposureWeights(analysis, riskScopeFor('exposure', 'taxable', config.wholePortfolioRules));

  return symbols
    .map((symbol) => {
      const quote: Quote | undefined = snapshot.quotes[symbol.toUpperCase()];
      const bars = snapshot.priceHistory[symbol.toUpperCase()] ?? [];
      if (!quote) return null;
      return {
        symbol: symbol.toUpperCase(),
        quote,
        bars,
        distributions: snapshot.distributions,
        asOf: snapshot.asOf,
        basis: config.distributionBasis,
        holdingReturnSeries,
        exposureWeights: weights,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Rank the whole income universe by cash-flow efficiency. */
export function rankOpportunities(
  snapshot: PortfolioSnapshot,
  analysis: PortfolioAnalysis,
  config: StrategyConfig,
  universe: string[] = INCOME_UNIVERSE,
): OpportunityRow[] {
  const inputs = buildEfficiencyInputs(universe, snapshot, analysis, config);
  const ranked = rankIncomeCandidates(inputs);
  // "Held" means held in the active calculation scope and brokerage-verified.
  // A simulated fixture must not set the bar a real candidate is measured against.
  const heldSymbols = new Set(
    analysis.scoped.positions.filter((p) => p.sleeve === 'income_engine' && p.verified).map((p) => p.symbol),
  );
  const bestHeldScore = Math.max(
    0,
    ...ranked.filter((r) => heldSymbols.has(r.symbol)).map((r) => r.score),
  );

  return ranked.map((efficiency) => {
    const held = heldSymbols.has(efficiency.symbol);
    const delta = bestHeldScore > 0 ? efficiency.score - bestHeldScore : null;

    let verdict: OpportunityRow['verdict'];
    let verdictReason: string;
    if (efficiency.stats.thinHistory) {
      verdict = 'insufficient_data';
      verdictReason = 'Fewer than three distributions in the trailing 13 weeks — not enough history to rank responsibly.';
    } else if (efficiency.totalReturn52w != null && efficiency.totalReturn52w < -0.15) {
      verdict = 'avoid';
      verdictReason = `52-week total return of ${(efficiency.totalReturn52w * 100).toFixed(1)}% means distributions have not covered NAV decline.`;
    } else if (!held && delta != null && delta > 4) {
      verdict = 'consider_adding';
      verdictReason = `Cash-flow efficiency is ${delta.toFixed(1)} points above the best currently-held income position.`;
    } else if (held) {
      verdict = 'maintain';
      verdictReason = 'Already held. Efficiency does not justify replacing it on this data.';
    } else {
      verdict = 'maintain';
      verdictReason = 'No material efficiency advantage over existing holdings.';
    }

    return {
      symbol: efficiency.symbol,
      name: getInstrumentOrFallback(efficiency.symbol).name,
      held,
      efficiency,
      scoreDeltaVsHeld: delta,
      verdict,
      verdictReason,
    };
  });
}

/**
 * Build the deterministic allocation plan for a given amount of new capital.
 *
 * Priority order, all configurable through StrategyConfig:
 *   1. Never draw from the protected external household reserve. It sits
 *      outside the brokerages, so it is never a source — and an underfunded
 *      reserve never withholds brokerage contributions either.
 *   2. While below the active income milestone, weight toward the income engine.
 *   3. Within the income engine, weight by cash-flow efficiency, but keep the
 *      configured target weights as a gravitational centre so the plan does not
 *      whipsaw between funds on small score changes.
 *   4. Respect concentration, exposure and leverage ceilings (the risk engine
 *      enforces these again afterwards).
 *   5. Only fund tactical leveraged positions when a deterministic entry signal
 *      exists AND there is sleeve headroom.
 */
export function buildAllocationPlan(args: {
  capital: number;
  snapshot: PortfolioSnapshot;
  analysis: PortfolioAnalysis;
  income: IncomeSummary;
  semis: SemiconductorEngine;
  config: StrategyConfig;
}): AllocationPlan {
  const { capital, snapshot, analysis, income, semis, config } = args;
  const reasoning: string[] = [];
  const constraints: string[] = [];
  const level = strategyLevelFor(income.forwardMonthlyIncome);
  const milestone = activeMilestone(config);

  const rankedIncome = rankIncomeCandidates(
    buildEfficiencyInputs(
      [...new Set([...INCOME_UNIVERSE, ...Object.keys(config.incomeAllocationTargets)])],
      snapshot,
      analysis,
      config,
    ),
  );

  // Accounts eligible to receive new capital, preferring the one that already
  // holds the target instrument so positions stay consolidated.
  const eligibleAccounts = analysis.accounts.filter((a) => a.account.allocationEligible);
  const accountFor = (symbol: string) => {
    const holder = analysis.positions.find((p) => p.symbol === symbol && p.account.allocationEligible);
    if (holder) return holder.account;
    return eligibleAccounts[0]?.account ?? null;
  };

  if (!eligibleAccounts.length) {
    return {
      availableCapital: capital,
      legs: [],
      reserved: capital,
      reservedReason: 'No allocation-eligible account is present. Roth IRA and education accounts are excluded by policy.',
      rankedIncome,
      reasoning: ['No allocation-eligible account available.'],
      constraints: ['All accounts are excluded from automated allocation.'],
      strategyLevel: level,
    };
  }

  reasoning.push(
    `Modeled forward income is $${income.forwardMonthlyIncome.toFixed(2)}/mo against the ${milestone.label} target of $${milestone.monthlyIncome}/mo — strategy level ${level.level} (${level.name}).`,
  );

  // ── Step 1: the household reserve is protected, not withheld.
  //
  // The external reserve lives outside the brokerages. An underfunded reserve
  // therefore does not reduce the capital that can be analysed or allocated —
  // it raises a warning. What is never permitted is the opposite direction:
  // no leg may ever be funded by drawing the reserve down.
  const deployable = capital;
  let reserved = 0;
  let reservedReason: string | null = null;
  const externalGap = analysis.totals.externalLiquidityGap;
  if (externalGap > 0) {
    constraints.push(
      `Household liquidity is $${externalGap.toFixed(2)} below the $${analysis.totals.externalLiquidityTarget.toFixed(0)} external reserve target. New contributions are still allocated, but the reserve should be restored before increasing pace.`,
    );
    reasoning.push(
      'External reserve is underfunded. It is protected capital: this plan neither draws from it nor withholds brokerage contributions on its behalf.',
    );
  }

  // ── Step 2: split between the income engine and growth per strategy level.
  const belowMilestone = income.forwardMonthlyIncome < milestone.monthlyIncome;
  const incomeShare = belowMilestone ? 1 : config.bifurcationReinvestShare;
  if (belowMilestone) {
    reasoning.push('Income engine is below the active milestone, so new capital is directed entirely to cash-flow generation.');
  } else {
    reasoning.push(
      `Active milestone is met, so new capital is split ${(incomeShare * 100).toFixed(0)}% income engine / ${((1 - incomeShare) * 100).toFixed(0)}% long-term growth per the configured bifurcation.`,
    );
  }

  const incomeBudget = deployable * incomeShare;
  const growthBudget = deployable - incomeBudget;

  const legs: AllocationLeg[] = [];

  // ── Step 3: income engine weights.
  // Blend configured target weights with efficiency scores so the plan is
  // responsive without being unstable. The 50/50 default is a starting point,
  // never a fixed rule.
  const targetSymbols = Object.keys(config.incomeAllocationTargets);
  const candidateSymbols = [
    ...new Set([
      ...targetSymbols,
      ...rankedIncome.slice(0, 4).filter((r) => !r.stats.thinHistory).map((r) => r.symbol),
    ]),
  ];

  const scored = candidateSymbols
    .map((symbol) => {
      const efficiency = rankedIncome.find((r) => r.symbol === symbol) ?? null;
      const targetWeight = config.incomeAllocationTargets[symbol] ?? 0;
      // Efficiency contributes on a 0-1 scale; the configured target anchors it.
      const efficiencyWeight = efficiency ? efficiency.score / 100 : 0;
      const blended = targetWeight * 0.6 + efficiencyWeight * 0.4;
      return { symbol, efficiency, targetWeight, blended };
    })
    .filter((s) => s.blended > 0 && (s.efficiency == null || !s.efficiency.stats.thinHistory))
    .sort((a, b) => b.blended - a.blended)
    // Keep the plan legible: at most three income legs.
    .slice(0, 3);

  const blendTotal = scored.reduce((acc, s) => acc + s.blended, 0);

  if (incomeBudget > 0 && blendTotal > 0) {
    for (const entry of scored) {
      const amount = incomeBudget * (entry.blended / blendTotal);
      if (amount < 1) continue;
      const account = accountFor(entry.symbol);
      if (!account) continue;
      const efficiency = entry.efficiency;
      const reasonParts: string[] = [];
      if (entry.targetWeight > 0) reasonParts.push(`configured target weight ${(entry.targetWeight * 100).toFixed(0)}%`);
      if (efficiency) reasonParts.push(`cash-flow efficiency ${efficiency.score.toFixed(1)}/100`);
      if (efficiency?.cashPerDollar13w != null) reasonParts.push(`13-week cash per dollar ${(efficiency.cashPerDollar13w * 100).toFixed(2)}%`);
      if (efficiency && efficiency.navChange26w != null && efficiency.navChange26w < -0.1) {
        reasonParts.push(`sized down for ${(efficiency.navChange26w * 100).toFixed(1)}% 26-week NAV erosion`);
      }
      legs.push({
        symbol: entry.symbol,
        amount,
        accountId: account.id,
        accountName: account.name,
        sleeve: 'income_engine',
        reason: reasonParts.join('; ') || 'Income-engine allocation.',
        efficiencyScore: efficiency?.score ?? null,
      });
    }
  } else if (incomeBudget > 0) {
    constraints.push('No income candidate has sufficient distribution history to allocate to.');
    reserved += incomeBudget;
  }

  // ── Step 4: growth budget.
  if (growthBudget > 1) {
    // Prefer a permanent semiconductor core whose trend is intact and whose
    // price is at a configured dip level.
    const dipCandidates = semis.cores
      .filter((c) => c.dip.actionable && c.trend.status !== 'TREND_LOST')
      .sort((a, b) => (b.dip.declineFromReference ?? 0) - (a.dip.declineFromReference ?? 0));

    const target = dipCandidates[0] ?? semis.cores.find((c) => c.trend.status === 'TREND_CONFIRMED') ?? semis.cores[0];
    const account = target ? accountFor(target.symbol) : null;
    if (target && account) {
      legs.push({
        symbol: target.symbol,
        amount: growthBudget,
        accountId: account.id,
        accountName: account.name,
        sleeve: 'core_growth',
        reason: dipCandidates.length
          ? `At a configured dip level (${((target.dip.declineFromReference ?? 0) * 100).toFixed(1)}% below ${target.dip.reference.replace(/_/g, ' ')}) with trend ${target.trend.status.replace(/_/g, ' ').toLowerCase()}.`
          : `Permanent semiconductor core; trend ${target.trend.status.replace(/_/g, ' ').toLowerCase()}. No dip level currently met.`,
        efficiencyScore: null,
      });
    } else {
      reserved += growthBudget;
      constraints.push('No growth candidate met the configured entry conditions; growth budget left uninvested.');
    }
  }

  // ── Step 5: tactical leverage is opt-in, never a residual.
  const tacticalReady = semis.tactical.filter(
    (t) => t.trend.status === 'TREND_CONFIRMED' && t.dip.actionable && !t.riskReduction.triggered,
  );
  if (semis.exposure.overLimit) {
    constraints.push(
      `Leveraged sleeve is at ${(semis.exposure.leveragedPct * 100).toFixed(1)}% against a ${(config.maxLeveragedSleevePct * 100).toFixed(0)}% ceiling — no tactical addition is permitted.`,
    );
  } else if (!tacticalReady.length) {
    constraints.push('No tactical semiconductor entry meets the configured trend and dip criteria.');
  } else {
    constraints.push(
      `${tacticalReady.map((t) => t.symbol).join(', ')} meet tactical entry criteria with $${semis.exposure.headroom.toFixed(2)} of sleeve headroom, but tactical additions require explicit approval rather than automatic allocation.`,
    );
  }

  for (const t of semis.tactical) {
    // Only a confirmed holding may justify a live harvest. A simulated fixture
    // is reported as `SIMULATED — ARMED` elsewhere but never enters reasoning.
    if (t.harvest.armedLive) {
      reasoning.push(
        `${t.symbol} harvest rule is ARMED: +${((t.harvest.gainPct ?? 0) * 100).toFixed(1)}% vs tactical basis triggers a ${(t.harvest.harvestPortionPct * 100).toFixed(0)}% harvest into ${t.destinationSymbol}.`,
      );
    }
  }

  const legTotal = legs.reduce((acc, l) => acc + l.amount, 0);
  const unallocated = Math.max(0, deployable - legTotal);
  if (unallocated > 1) {
    reserved += unallocated;
    if (!reservedReason) reservedReason = `$${unallocated.toFixed(2)} left uninvested — no leg met the configured criteria for it.`;
  }

  if (analysis.concentrationBreaches.length) {
    constraints.push(
      `Concentration ceiling already exceeded by ${analysis.concentrationBreaches.map((b) => `${b.symbol} at ${(b.weight * 100).toFixed(1)}%`).join(', ')}.`,
    );
  }

  return {
    availableCapital: capital,
    legs,
    reserved,
    reservedReason,
    rankedIncome,
    reasoning,
    constraints,
    strategyLevel: level,
  };
}

/** Efficiency detail for a single symbol, used by the Opportunities drill-down. */
export function efficiencyFor(
  symbol: string,
  snapshot: PortfolioSnapshot,
  analysis: PortfolioAnalysis,
  config: StrategyConfig,
): CashFlowEfficiency | null {
  const [input] = buildEfficiencyInputs([symbol], snapshot, analysis, config);
  return input ? computeCashFlowEfficiency(input) : null;
}

/** What is currently slowing the strategy down — deterministic diagnosis. */
export function diagnoseDrag(args: {
  analysis: PortfolioAnalysis;
  income: IncomeSummary;
  semis: SemiconductorEngine;
  config: StrategyConfig;
  opportunities: OpportunityRow[];
}): { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[] {
  const { analysis, income, semis, config, opportunities } = args;
  const out: { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[] = [];

  const milestone = activeMilestone(config);
  const gap = milestone.monthlyIncome - income.forwardMonthlyIncome;

  if (income.incomeEngineCapital <= 0) {
    out.push({
      severity: 'high',
      title: 'No income capital deployed',
      detail: 'The income engine holds no capital, so there is no cash flow to compound.',
    });
  }

  for (const p of income.positions) {
    if ((p.navChange26w ?? 0) < -0.15) {
      out.push({
        severity: 'high',
        title: `${p.symbol} NAV erosion`,
        detail: `${p.symbol} price is down ${((p.navChange26w ?? 0) * 100).toFixed(1)}% over 26 weeks. Distributions are partly funded by the capital base, which slows real compounding even while cash arrives.`,
      });
    }
    if ((p.totalReturn52w ?? 0) < 0) {
      out.push({
        severity: 'high',
        title: `${p.symbol} negative total return`,
        detail: `Over 52 weeks, ${p.symbol} distributions have not covered its price decline. Cash received is not economic profit here.`,
      });
    }
    if (p.stats.trend < -0.03) {
      out.push({
        severity: 'medium',
        title: `${p.symbol} distributions declining`,
        detail: `Per-payment distributions are trending down ${(Math.abs(p.stats.trend) * 100).toFixed(1)}% per payment over the trailing window, which pushes the milestone date out.`,
      });
    }
  }

  if (config.monthlyContribution <= 0 && gap > 0) {
    out.push({
      severity: 'high',
      title: 'No recurring contribution configured',
      detail: `With DRIP alone and no external contribution, closing the $${gap.toFixed(0)}/mo gap depends entirely on compounding.`,
    });
  }

  if (analysis.totals.externalReserveUnderfunded) {
    out.push({
      severity: 'medium',
      title: 'External liquidity reserve underfunded',
      detail: `Household liquidity of $${analysis.totals.externalLiquidityCurrent.toFixed(2)} is $${analysis.totals.externalLiquidityGap.toFixed(2)} below the $${analysis.totals.externalLiquidityTarget.toFixed(0)} target. This reserve is held outside the brokerages; restoring it takes priority over increasing investment pace, and it is never a funding source.`,
    });
  }

  if (semis.exposure.overLimit) {
    out.push({
      severity: 'high',
      title: 'Leveraged sleeve over ceiling',
      detail: `Leveraged exposure is ${(semis.exposure.leveragedPct * 100).toFixed(1)}% against a ${(config.maxLeveragedSleevePct * 100).toFixed(0)}% ceiling.`,
    });
  }

  const better = opportunities.filter((o) => o.verdict === 'consider_adding');
  if (better.length) {
    out.push({
      severity: 'medium',
      title: 'A more cash-flow-efficient instrument is available',
      detail: `${better.map((o) => `${o.symbol} (+${(o.scoreDeltaVsHeld ?? 0).toFixed(1)} pts)`).join(', ')} score above the best currently-held income position.`,
    });
  }

  const investable = analysis.totals.deployableBrokerCash;
  if (investable > 50 && income.forwardMonthlyIncome < milestone.monthlyIncome) {
    out.push({
      severity: 'low',
      title: 'Uninvested brokerage cash',
      detail: `$${investable.toFixed(2)} of deployable brokerage cash is producing no distributions.`,
    });
  }

  // Measured in the risk scope, not the whole household: a Roth holding must
  // not raise a concentration alarm against a taxable-income recommendation.
  const exposureScope = analysis.scopes[riskScopeFor('exposure', 'taxable', config.wholePortfolioRules)];
  const concentration = exposureScope.exposures.find((e) => e.weight > config.maxSingleExposurePct);
  if (concentration) {
    out.push({
      severity: 'medium',
      title: `Concentrated in ${concentration.exposure.toUpperCase()}`,
      detail: `${(concentration.weight * 100).toFixed(1)}% of ${exposureScope.label} capital depends on one underlying (${concentration.symbols.join(', ')}), above the ${(config.maxSingleExposurePct * 100).toFixed(0)}% ceiling.`,
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export { safeDiv };
