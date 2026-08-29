/**
 * Composition layer: turns a snapshot plus stored strategy config into API payloads.
 * Arithmetic remains in core/strategy/risk modules.
 */
import type { PortfolioSnapshot } from '../core/types.js';
import type { StrategyConfig } from '../core/config.js';
import { activeMilestone, strategyLevelFor } from '../core/config.js';
import { analyzePortfolio, type PortfolioAnalysis } from '../core/portfolio.js';
import { buildIncomeSummary, computeIncomeVelocity, milestoneProgress, monthlyReceivedIncome, requiredCapitalForIncome, weeklyDistributionSeries, type IncomeSummary } from '../core/income.js';
import { buildSemiconductorEngine } from '../core/semiconductor.js';
import { computeDipSignal, computeTrendSignal } from '../core/signals.js';
import { buildAllocationPlan, diagnoseDrag, rankOpportunities } from '../strategy/allocation.js';
import { buildScenarios, projectIncome, solveMonthlyContribution } from '../core/projection.js';
import { INCOME_UNIVERSE, LEVERAGED_SYMBOLS, WATCHLISTS } from '../core/universe.js';
import { applyHaircut } from '../core/distributions.js';
import { CALCULATION_SCOPES, CALCULATION_SCOPE_DESCRIPTIONS, CALCULATION_SCOPE_LABELS, riskScopeFor } from '../core/scope.js';

export interface AnalysisContext { snapshot: PortfolioSnapshot; config: StrategyConfig; analysis: PortfolioAnalysis; income: IncomeSummary; }

export function buildAnalysisContext(snapshot: PortfolioSnapshot, config: StrategyConfig): AnalysisContext {
  const analysis = analyzePortfolio(snapshot, config);
  const income = buildIncomeSummary(snapshot, analysis, config);
  return { snapshot, config, analysis, income };
}

export function scopeBlock(ctx: AnalysisContext) {
  const { analysis, income } = ctx;
  return {
    scope: analysis.scope,
    scopeLabel: CALCULATION_SCOPE_LABELS[analysis.scope],
    scopeDescription: CALCULATION_SCOPE_DESCRIPTIONS[analysis.scope],
    scopeOptions: CALCULATION_SCOPES.map((scope) => {
      const view = analysis.scopes[scope];
      return { scope, label: CALCULATION_SCOPE_LABELS[scope], description: CALCULATION_SCOPE_DESCRIPTIONS[scope], investedValue: view.investedValue, totalValue: view.totalValue, incomeEngineCapital: view.incomeEngineCapital, positionCount: view.positions.length, accountCount: view.accountIds.length, containsSimulated: view.containsSimulated };
    }),
    excluded: analysis.scoped.excluded,
    incomeExcluded: income.excluded,
    confirmedValue: analysis.scoped.confirmedValue,
    simulatedValue: analysis.scoped.simulatedValue,
    containsSimulated: analysis.scoped.containsSimulated,
  };
}

export function provenance(snapshot: PortfolioSnapshot) {
  return { asOf: snapshot.asOf, dataQuality: snapshot.dataQuality, containsMockData: snapshot.containsMockData, sourceNotes: snapshot.sourceNotes };
}

export function buildPortfolioPayload(ctx: AnalysisContext, priorMonthlyIncome: number | null) {
  const { snapshot, config, analysis, income } = ctx;
  const milestone = activeMilestone(config);
  const exposureScope = riskScopeFor('exposure', 'taxable', config.wholePortfolioRules);
  const velocity = computeIncomeVelocity({ income, config, priorMonthlyIncome, priorPeriodMonths: 1 });
  const level = strategyLevelFor(income.forwardMonthlyIncome);
  const progress = milestoneProgress(income, config);
  return {
    ...provenance(snapshot), ...scopeBlock(ctx), config, strategyLevel: level, milestone, milestones: progress, totals: analysis.totals,
    scopedTotals: { investedValue: analysis.scoped.investedValue, brokerCash: analysis.scoped.brokerCash, deployableBrokerCash: analysis.scoped.deployableBrokerCash, totalValue: analysis.scoped.totalValue, costBasis: analysis.scoped.costBasis, unrealizedPL: analysis.scoped.unrealizedPL, unrealizedPLPct: analysis.scoped.unrealizedPLPct, incomeEngineCapital: analysis.scoped.incomeEngineCapital, incomeEnginePct: analysis.scoped.incomeEnginePct },
    accounts: analysis.accounts,
    positions: analysis.positions.map((p) => ({ symbol: p.symbol, name: p.name, accountId: p.account.id, accountName: p.account.name, broker: p.account.broker, sleeve: p.sleeve, leverage: p.leverage, exposure: p.exposure, sector: p.sector, shares: p.shares, price: p.price, marketValue: p.marketValue, costBasisTotal: p.costBasisTotal, costBasisPerShare: p.costBasisPerShare, unrealizedPL: p.unrealizedPL, unrealizedPLPct: p.unrealizedPLPct, dayChangePct: p.dayChangePct, weight: p.weight, scopeWeight: analysis.scoped.weights[p.holding.id] ?? null, inScope: analysis.scoped.weights[p.holding.id] != null, legacy: p.legacy, accountType: p.accountType, verification: p.verification, verified: p.verified, allocationEligible: p.account.allocationEligible, costBasisKnown: p.holding.costBasisKnown ?? p.costBasisTotal > 0 })),
    sleeves: analysis.sleeves, exposures: analysis.exposures, scopedSleeves: analysis.scoped.sleeves, scopedExposures: analysis.scoped.exposures,
    exposureScope, riskExposures: analysis.scopes[exposureScope].exposures,
    leveraged: { value: analysis.leveragedValue, pct: analysis.leveragedPct, maxPct: config.maxLeveragedSleevePct },
    concentrationBreaches: analysis.concentrationBreaches, concentrationScope: analysis.concentrationScope, simulatedConcentrationBreaches: analysis.scopes[analysis.concentrationScope].simulatedConcentrationBreaches,
    incomeSummary: { forwardMonthlyIncome: income.forwardMonthlyIncome, conservativeMonthlyIncome: income.conservativeMonthlyIncome, forwardWeeklyIncome: income.forwardWeeklyIncome, forwardAnnualIncome: income.forwardAnnualIncome, received30d: income.received30d, received7d: income.received7d, receivedLifetime: income.receivedLifetime, incomeEngineCapital: income.incomeEngineCapital, blendedDistributionRate: income.blendedDistributionRate, estimatedEconomicIncomeMonthly: income.estimatedEconomicIncomeMonthly, simulatedCapital: income.simulatedCapital, flags: income.flags },
    velocity, valueHistory: portfolioValueHistory(ctx, 180),
  };
}

export function portfolioValueHistory(ctx: AnalysisContext, days: number) {
  const { snapshot, analysis } = ctx;
  const dates = new Set<string>();
  for (const position of analysis.positions) for (const bar of (snapshot.priceHistory[position.symbol] ?? []).slice(-days)) dates.add(bar.date);
  const ordered = [...dates].sort();
  const closeAt: Record<string, Map<string, number>> = {};
  for (const position of analysis.positions) closeAt[position.symbol] = new Map((snapshot.priceHistory[position.symbol] ?? []).map((b) => [b.date, b.close]));
  const lastKnown: Record<string, number> = {};
  return ordered.map((date) => {
    let value = 0;
    for (const position of analysis.positions) { const close = closeAt[position.symbol].get(date) ?? lastKnown[position.symbol]; if (close == null) continue; lastKnown[position.symbol] = close; value += position.shares * close; }
    return { date, value: value + analysis.totals.totalCash };
  });
}

function scopedIncomeEvents(ctx: AnalysisContext) {
  const ids = new Set(ctx.analysis.scoped.accountIds); const symbols = new Set(ctx.income.positions.map((p) => p.symbol));
  return ctx.snapshot.incomeEvents.filter((e) => ids.has(e.accountId) && symbols.has(e.symbol.toUpperCase()));
}

export function buildIncomePayload(ctx: AnalysisContext, priorMonthlyIncome: number | null) {
  const { snapshot, config, income } = ctx;
  const milestone = activeMilestone(config); const velocity = computeIncomeVelocity({ income, config, priorMonthlyIncome, priorPeriodMonths: 1 });
  const requiredCapital = requiredCapitalForIncome(milestone.monthlyIncome, income.blendedDistributionRate ?? 0);
  const requiredCapitalConservative = requiredCapitalForIncome(milestone.monthlyIncome, income.blendedConservativeRate ?? 0);
  return { ...provenance(snapshot), ...scopeBlock(ctx), config, milestone, milestones: milestoneProgress(income, config), strategyLevel: strategyLevelFor(income.forwardMonthlyIncome), income, velocity, requiredCapital, requiredCapitalConservative, monthlyReceived: monthlyReceivedIncome(scopedIncomeEvents(ctx)), weeklySeries: income.positions.map((p) => ({ symbol: p.symbol, series: weeklyDistributionSeries(snapshot.distributions, p.symbol, 52) })) };
}

export function buildSignalsPayload(ctx: AnalysisContext) {
  const { snapshot, config, analysis, income } = ctx;
  const semis = buildSemiconductorEngine({ analysis, quotes: snapshot.quotes, priceHistory: snapshot.priceHistory, config });
  const watchSymbols = [...new Set([...WATCHLISTS.semiconductorResearch, ...LEVERAGED_SYMBOLS, ...INCOME_UNIVERSE.slice(0, 8), ...analysis.positions.map((p) => p.symbol)])];
  const benchmarkBars = snapshot.priceHistory[config.trend.benchmarkSymbol] ?? [];
  const signals = watchSymbols.map((symbol) => {
    const quote = snapshot.quotes[symbol]; const bars = snapshot.priceHistory[symbol] ?? [];
    if (!quote || !bars.length) return null;
    const trend = computeTrendSignal({ symbol, bars, quote, config: config.trend, benchmarkBars });
    const dip = computeDipSignal({ symbol, bars, quote, config, trend });
    const position = analysis.positions.find((p) => p.symbol === symbol) ?? null;
    return { symbol, held: position != null, sleeve: position?.sleeve ?? null, price: quote.price, dayChangePct: quote.dayChangePct, trend, dip };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  const opportunities = rankOpportunities(snapshot, analysis, config);
  const drag = diagnoseDrag({ analysis, income, semis, config, opportunities });
  return { ...provenance(snapshot), ...scopeBlock(ctx), config, semis, signals, opportunities, drag };
}

export function investableCapital(ctx: AnalysisContext): number { return Math.max(0, ctx.analysis.totals.deployableBrokerCash); }
export function buildPlan(ctx: AnalysisContext, capital: number) {
  const { snapshot, config, analysis, income } = ctx;
  const semis = buildSemiconductorEngine({ analysis, quotes: snapshot.quotes, priceHistory: snapshot.priceHistory, config });
  return buildAllocationPlan({ capital, snapshot, analysis, income, semis, config });
}

export interface SimulatorRequest {
  monthlyContribution?: number;
  lumpSum?: number;
  lumpSumMonth?: number;
  dripRate?: number;
  targetMonthlyIncome?: number;
  horizonMonths?: number;
  basisOverrideRate?: number;
  /** Modeling Lab only: hypothetical post-strategy income-producing capital. */
  startingIncomeCapitalOverride?: number;
}

export function buildSimulation(ctx: AnalysisContext, request: SimulatorRequest) {
  const { config, income, snapshot } = ctx;
  const milestone = activeMilestone(config);
  const target = request.targetMonthlyIncome ?? milestone.monthlyIncome;
  const horizon = Math.min(Math.max(request.horizonMonths ?? 36, 1), 240);
  const modeledRate = request.basisOverrideRate ?? income.blendedDistributionRate ?? 0;
  const conservativeRate = income.blendedConservativeRate ?? applyHaircut(modeledRate, config.conservativeHaircut) ?? 0;
  const enginePrice = income.positions[0]?.price;
  const solverBase = {
    startingIncomeCapital: request.startingIncomeCapitalOverride ?? income.incomeEngineCapital,
    monthlyContribution: request.monthlyContribution ?? config.monthlyContribution,
    lumpSum: request.lumpSum ?? 0,
    lumpSumMonth: request.lumpSumMonth ?? 0,
    annualDistributionRate: modeledRate,
    dripRate: request.dripRate ?? config.dripRate,
    targetMonthlyIncome: target,
    sharePrice: enginePrice,
    bifurcationReinvestShare: config.bifurcationReinvestShare,
    startDate: snapshot.asOf,
  };
  const base = { ...solverBase, horizonMonths: horizon };
  const scenarios = buildScenarios(base, { conservative: conservativeRate, base: modeledRate, aggressive: modeledRate });
  const requiredContributions = [12, 18, 24, 36].map((months) => ({ months, monthlyContribution: solveMonthlyContribution(solverBase, months), conservativeMonthlyContribution: solveMonthlyContribution({ ...solverBase, annualDistributionRate: conservativeRate }, months) }));
  return { ...provenance(snapshot), ...scopeBlock(ctx), target, modeledRate, conservativeRate, inputs: base, scenarios, requiredContributions, projection: projectIncome(base) };
}
