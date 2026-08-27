import { describe, expect, it } from 'vitest';
import type { StrategyConfig } from '../src/core/config.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/core/config.js';
import { analyzePortfolio } from '../src/core/portfolio.js';
import { buildIncomeSummary, milestoneProgress } from '../src/core/income.js';
import { buildSemiconductorEngine } from '../src/core/semiconductor.js';
import { buildAllocationPlan } from '../src/strategy/allocation.js';
import { validateOrders } from '../src/risk/engine.js';
import type { ProposedOrder } from '../src/risk/types.js';
import {
  AS_OF,
  flatBars,
  linearBars,
  makeAccount,
  makeHolding,
  makeSnapshot,
  payments,
  quotesFor,
  steadyWeekly,
} from './helpers.js';

/**
 * Phase 1.1 financial semantics.
 *
 * The defect these tests pin down: every figure used to be measured over the
 * whole portfolio, so a Roth dividend ETF and a Coverdell REIT fund diluted the
 * blended distribution rate of a two-position taxable income engine — and
 * therefore inflated the capital required to reach $500/month. Separately, a
 * $10,000 "liquidity reserve" was measured against brokerage cash, which froze
 * a $461 account at $0 investable, and unverified demo fixtures were
 * indistinguishable from the two confirmed holdings.
 *
 * The arithmetic below is written out longhand so each expectation can be
 * checked by hand.
 */

const NVDY_PRICE = 12.5;
const YMAG_PRICE = 11.12;
const SCHD_PRICE = 28;
const VNQ_PRICE = 90;

const NVDY_SHARES = 7.9;
const YMAG_SHARES = 11;
const SCHD_SHARES = 41.2836;
const VNQ_SHARES = 6.1042;

/** Weekly per-share distributions for the two confirmed engine positions. */
const NVDY_WEEKLY = 0.2;
const YMAG_WEEKLY = 0.1;
/** Quarterly per-share distributions for the long-term holdings. */
const SCHD_QUARTERLY = 0.28;
const VNQ_QUARTERLY = 0.9;

const NVDY_VALUE = NVDY_SHARES * NVDY_PRICE; // 98.75
const YMAG_VALUE = YMAG_SHARES * YMAG_PRICE; // 122.32
const ENGINE_CAPITAL = NVDY_VALUE + YMAG_VALUE; // 221.07

const NVDY_ANNUAL = NVDY_SHARES * NVDY_WEEKLY * 52; // 82.16
const YMAG_ANNUAL = YMAG_SHARES * YMAG_WEEKLY * 52; // 57.20
const ENGINE_ANNUAL = NVDY_ANNUAL + YMAG_ANNUAL; // 139.36
const ENGINE_RATE = ENGINE_ANNUAL / ENGINE_CAPITAL; // ~0.6304

/**
 * The real account shape: two taxable brokerages that the strategy deploys
 * into, plus a Roth IRA and a Coverdell that it must never touch.
 */
function householdSnapshot(over: { rhCash?: number; schCash?: number } = {}) {
  return makeSnapshot({
    accounts: [
      makeAccount('rh-1', {
        broker: 'robinhood',
        name: 'Active Accumulation',
        type: 'taxable',
        cash: over.rhCash ?? 82.44,
      }),
      makeAccount('sch-1', {
        broker: 'schwab',
        name: 'Income / Value / Cyclical',
        type: 'taxable',
        cash: over.schCash ?? 146.19,
      }),
      makeAccount('roth-1', {
        broker: 'schwab',
        name: 'Roth IRA',
        type: 'roth_ira',
        cash: 18.03,
        allocationEligible: false,
      }),
      makeAccount('cov-1', {
        broker: 'schwab',
        name: 'Coverdell ESA',
        type: 'education',
        cash: 214.87,
        allocationEligible: false,
      }),
    ],
    holdings: [
      makeHolding('rh-1', 'NVDY', NVDY_SHARES, 13.41, { verification: 'CONFIRMED' }),
      makeHolding('sch-1', 'YMAG', YMAG_SHARES, 11.58, { verification: 'CONFIRMED' }),
      makeHolding('roth-1', 'SCHD', SCHD_SHARES, 24.19, { verification: 'SIMULATED' }),
      makeHolding('cov-1', 'VNQ', VNQ_SHARES, 84.71, { verification: 'SIMULATED' }),
    ],
    quotes: quotesFor({ NVDY: NVDY_PRICE, YMAG: YMAG_PRICE, SCHD: SCHD_PRICE, VNQ: VNQ_PRICE }),
    distributions: [
      ...steadyWeekly('NVDY', NVDY_WEEKLY, 52),
      ...steadyWeekly('YMAG', YMAG_WEEKLY, 52),
      ...payments('SCHD', new Array(8).fill(SCHD_QUARTERLY) as number[], {
        intervalDays: 91,
        frequency: 'quarterly',
      }),
      ...payments('VNQ', new Array(8).fill(VNQ_QUARTERLY) as number[], {
        intervalDays: 91,
        frequency: 'quarterly',
      }),
    ],
    priceHistory: {
      NVDY: flatBars(NVDY_PRICE, 220),
      YMAG: flatBars(YMAG_PRICE, 220),
      SCHD: flatBars(SCHD_PRICE, 220),
      VNQ: flatBars(VNQ_PRICE, 220),
    },
  });
}

/** `latest` basis, so the modeled rate is the hand-written per-share figure. */
function configFor(over: Partial<StrategyConfig> = {}): StrategyConfig {
  return { ...DEFAULT_STRATEGY_CONFIG, distributionBasis: 'latest', ...over };
}

function summaryFor(config: StrategyConfig, snapshot = householdSnapshot()) {
  const analysis = analyzePortfolio(snapshot, config);
  return { snapshot, analysis, income: buildIncomeSummary(snapshot, analysis, config) };
}

describe('the taxable income engine is not diluted by long-term holdings', () => {
  it('excludes Roth and education positions from the $500/month capital requirement', () => {
    const engine = summaryFor(configFor());
    expect(engine.income.scope).toBe('TAXABLE_INCOME_ENGINE');
    expect(engine.income.positions.map((p) => p.symbol).sort()).toEqual(['NVDY', 'YMAG']);
    expect(engine.income.incomeEngineCapital).toBeCloseTo(ENGINE_CAPITAL, 8);

    // SCHD and VNQ are reported as excluded rather than silently dropped.
    expect(engine.income.excluded.map((e) => e.symbol).sort()).toEqual(['SCHD', 'VNQ']);
    for (const excluded of engine.income.excluded) {
      expect(excluded.reason).toBeTruthy();
    }

    const engineB = milestoneProgress(engine.income, configFor()).find((m) => m.targetMonthlyIncome === 500)!;
    // $500/month at the engine's own blended rate.
    expect(engineB.requiredCapital).toBeCloseTo((500 * 12) / ENGINE_RATE, 6);

    // The same portfolio measured whole. SCHD and VNQ pay ~4%, so including
    // them collapses the blended rate and multiplies the capital requirement.
    const whole = summaryFor(configFor({ calculationScope: 'ENTIRE_PORTFOLIO' }));
    const wholeB = milestoneProgress(whole.income, configFor({ calculationScope: 'ENTIRE_PORTFOLIO' })).find(
      (m) => m.targetMonthlyIncome === 500,
    )!;
    expect(whole.income.positions.map((p) => p.symbol).sort()).toEqual(['NVDY', 'SCHD', 'VNQ', 'YMAG']);
    expect(wholeB.requiredCapital!).toBeGreaterThan(engineB.requiredCapital! * 5);

    // The regression this guards: the engine figure must not move when a
    // long-term holding grows.
    const bigger = householdSnapshot();
    bigger.holdings = bigger.holdings.map((h) => (h.symbol === 'SCHD' ? { ...h, shares: SCHD_SHARES * 10 } : h));
    const unchanged = summaryFor(configFor(), bigger);
    expect(unchanged.income.incomeEngineCapital).toBeCloseTo(ENGINE_CAPITAL, 8);
    expect(unchanged.income.blendedDistributionRate).toBeCloseTo(ENGINE_RATE, 10);
  });

  it('derives the initial blended rate from NVDY and YMAG alone', () => {
    const { income } = summaryFor(configFor());
    expect(income.forwardAnnualIncome).toBeCloseTo(ENGINE_ANNUAL, 8);
    expect(income.forwardMonthlyIncome).toBeCloseTo(ENGINE_ANNUAL / 12, 8);
    expect(income.blendedDistributionRate).toBeCloseTo(ENGINE_RATE, 10);
    // Weighted, not averaged: YMAG is the larger position, so the blend sits
    // between the two instrument rates and below NVDY's.
    const nvdyRate = (NVDY_WEEKLY * 52) / NVDY_PRICE;
    const ymagRate = (YMAG_WEEKLY * 52) / YMAG_PRICE;
    expect(income.blendedDistributionRate!).toBeLessThan(nvdyRate);
    expect(income.blendedDistributionRate!).toBeGreaterThan(ymagRate);
    expect(income.blendedConservativeRate).toBeCloseTo(ENGINE_RATE * (1 - DEFAULT_STRATEGY_CONFIG.conservativeHaircut), 10);
  });

  it('excludes Roth and education distributions from received income', () => {
    const snapshot = householdSnapshot();
    snapshot.incomeEvents = [
      { id: '1', accountId: 'sch-1', symbol: 'YMAG', payDate: AS_OF, grossAmount: 5, sharesAtRecord: 11, reinvested: true },
      { id: '2', accountId: 'roth-1', symbol: 'SCHD', payDate: AS_OF, grossAmount: 11.56, sharesAtRecord: SCHD_SHARES, reinvested: true },
    ];
    const engine = summaryFor(configFor(), snapshot);
    expect(engine.income.received30d).toBeCloseTo(5, 8);
    const whole = summaryFor(configFor({ calculationScope: 'ENTIRE_PORTFOLIO' }), snapshot);
    expect(whole.income.received30d).toBeCloseTo(16.56, 8);
  });
});

describe('entire-portfolio scope', () => {
  it('includes every account and position when deliberately selected', () => {
    const analysis = analyzePortfolio(householdSnapshot(), configFor({ calculationScope: 'ENTIRE_PORTFOLIO' }));
    const whole = analysis.scopes.ENTIRE_PORTFOLIO;
    expect(whole.accountIds.sort()).toEqual(['cov-1', 'rh-1', 'roth-1', 'sch-1']);
    expect(whole.positions.map((p) => p.symbol).sort()).toEqual(['NVDY', 'SCHD', 'VNQ', 'YMAG']);
    expect(whole.excluded).toEqual([]);
    expect(whole.investedValue).toBeCloseTo(
      NVDY_VALUE + YMAG_VALUE + SCHD_SHARES * SCHD_PRICE + VNQ_SHARES * VNQ_PRICE,
      8,
    );
    // Selecting it makes it the active view.
    expect(analysis.scope).toBe('ENTIRE_PORTFOLIO');
    expect(analysis.scoped.positions).toHaveLength(4);

    // The narrower scopes stay narrow, and each is a subset of the next.
    const taxable = analysis.scopes.ALL_TAXABLE;
    const engine = analysis.scopes.TAXABLE_INCOME_ENGINE;
    expect(taxable.accountIds.sort()).toEqual(['rh-1', 'sch-1']);
    expect(taxable.positions.map((p) => p.symbol).sort()).toEqual(['NVDY', 'YMAG']);
    expect(engine.positions.map((p) => p.symbol).sort()).toEqual(['NVDY', 'YMAG']);
  });
});

describe('household liquidity is not brokerage cash', () => {
  it('still allocates a contribution while the external reserve is underfunded', () => {
    const config = configFor();
    const { snapshot, analysis, income } = summaryFor(config);
    // The household reserve target is $10,000 and nothing is held against it.
    expect(analysis.totals.externalLiquidityTarget).toBe(10_000);
    expect(analysis.totals.externalReserveUnderfunded).toBe(true);
    // Every dollar of eligible brokerage cash is still deployable — the old
    // model reported $0 here and stalled the strategy.
    const eligibleCash = 82.44 + 146.19;
    expect(analysis.totals.brokerCash).toBeCloseTo(eligibleCash + 18.03 + 214.87, 8);
    // Only the two taxable accounts are allocation-eligible, so only their cash
    // is deployable — the Roth and Coverdell balances stay untouched.
    expect(analysis.totals.deployableBrokerCash).toBeCloseTo(eligibleCash, 8);

    const semis = buildSemiconductorEngine({
      analysis,
      quotes: snapshot.quotes,
      priceHistory: snapshot.priceHistory,
      config,
    });
    const plan = buildAllocationPlan({
      capital: analysis.totals.deployableBrokerCash + 300,
      snapshot,
      analysis,
      income,
      semis,
      config,
    });
    const allocated = plan.legs.reduce((acc, leg) => acc + leg.amount, 0);
    expect(allocated).toBeGreaterThan(0);
    // Nothing is withheld on the reserve's behalf…
    expect(plan.reserved).toBe(0);
    // …but the shortfall is stated plainly.
    expect(plan.constraints.join(' ')).toContain('external reserve target');
    expect(plan.reasoning.join(' ')).toContain('protected capital');
  });

  it('never offers the external reserve as a funding source', () => {
    const config = configFor();
    const { snapshot, analysis, income } = summaryFor(config);
    const order: ProposedOrder = {
      id: 'o-1',
      accountId: 'sch-1',
      broker: 'schwab',
      symbol: 'YMAG',
      side: 'buy',
      notional: 50,
      orderType: 'market',
      rationale: 'Top up the engine from the household reserve.',
      origin: 'claude',
      fundingSource: 'external_reserve',
      sleeve: 'income_engine',
    };
    const decision = validateOrders([order], {
      asOf: AS_OF,
      analysis,
      income,
      quotes: snapshot.quotes,
      config,
    });
    const finding = decision.findings.find((f) => f.code === 'EXTERNAL_RESERVE_DRAW')!;
    expect(finding.severity).toBe('block');
    expect(decision.approved).toBe(false);
  });
});

describe('unverified holdings cannot activate live triggers', () => {
  /** A taxable book with a SIMULATED, deeply-in-profit SOXL position. */
  function soxlSnapshot(verification: 'CONFIRMED' | 'SIMULATED') {
    return makeSnapshot({
      accounts: [makeAccount('sch-1', { broker: 'schwab', name: 'Income / Value / Cyclical', cash: 500 })],
      holdings: [
        makeHolding('sch-1', 'NVDY', NVDY_SHARES, 13.41, { verification: 'CONFIRMED' }),
        makeHolding('sch-1', 'SOXL', 1.4072, 21.36, {
          tacticalCostBasisTotal: Number((1.4072 * 21.36).toFixed(4)),
          verification,
        }),
      ],
      quotes: quotesFor({ NVDY: NVDY_PRICE, SOXL: 40, SMH: 260, TSM: 200 }),
      distributions: steadyWeekly('NVDY', NVDY_WEEKLY, 52),
      priceHistory: {
        NVDY: flatBars(NVDY_PRICE, 220),
        SOXL: linearBars(20, 40, 220),
        SMH: linearBars(200, 260, 220),
        TSM: linearBars(160, 200, 220),
      },
    });
  }

  function harvestFor(verification: 'CONFIRMED' | 'SIMULATED') {
    const config = configFor();
    const snapshot = soxlSnapshot(verification);
    const analysis = analyzePortfolio(snapshot, config);
    const semis = buildSemiconductorEngine({
      analysis,
      quotes: snapshot.quotes,
      priceHistory: snapshot.priceHistory,
      config,
    });
    return { config, snapshot, analysis, semis, soxl: semis.tactical.find((t) => t.symbol === 'SOXL')!.harvest };
  }

  it('arms the rule for display but refuses to make it live', () => {
    // SOXL at $40 against a $21.36 tactical basis is +87%, far past the +25%
    // trigger, so the price condition is unambiguously met.
    const simulated = harvestFor('SIMULATED');
    expect(simulated.soxl.armed).toBe(true);
    expect(simulated.soxl.armedLive).toBe(false);
    expect(simulated.soxl.verification).toBe('SIMULATED');
    expect(simulated.soxl.ruleOutcome).toContain('SIMULATED — ARMED');
    expect(simulated.soxl.ruleOutcome).toContain('verifies ownership and cost basis');

    // The same position, confirmed, fires normally. Verification is the only
    // difference between these two runs.
    const confirmed = harvestFor('CONFIRMED');
    expect(confirmed.soxl.armed).toBe(true);
    expect(confirmed.soxl.armedLive).toBe(true);
    expect(confirmed.soxl.ruleOutcome).toContain('ARMED');
    expect(confirmed.soxl.ruleOutcome).not.toContain('SIMULATED');
  });

  it('keeps a simulated leg out of the live flywheel', () => {
    const simulated = harvestFor('SIMULATED');
    const leg = simulated.semis.flywheel.find((l) => l.from === 'SOXL')!;
    expect(leg.armed).toBe(true);
    expect(leg.armedLive).toBe(false);
    expect(leg.verification).toBe('SIMULATED');
  });

  it('reports a simulated concentration breach without gating on it', () => {
    const config = configFor({ maxSinglePositionPct: 0.05 });
    const snapshot = soxlSnapshot('SIMULATED');
    const analysis = analyzePortfolio(snapshot, config);
    const scope = analysis.scopes[analysis.concentrationScope];
    // SOXL is well past a 5% ceiling, but it is not a live finding.
    expect(scope.simulatedConcentrationBreaches.map((b) => b.symbol)).toContain('SOXL');
    expect(scope.concentrationBreaches.map((b) => b.symbol)).not.toContain('SOXL');
    // Only confirmed capital counts toward the risk denominator.
    expect(scope.verifiedTotalValue).toBeCloseTo(NVDY_VALUE + 500, 8);
  });

  it('blocks a sell or harvest of an unverified position', () => {
    const config = configFor();
    const snapshot = soxlSnapshot('SIMULATED');
    const analysis = analyzePortfolio(snapshot, config);
    const order: ProposedOrder = {
      id: 'h-1',
      accountId: 'sch-1',
      broker: 'schwab',
      symbol: 'SOXL',
      side: 'sell',
      quantity: 0.35,
      orderType: 'market',
      rationale: 'Harvest 25% of the tactical gain into SMH.',
      origin: 'harvest_rule',
      sleeve: 'tactical_leveraged',
    };
    const decision = validateOrders([order], {
      asOf: AS_OF,
      analysis,
      income: null,
      quotes: snapshot.quotes,
      config,
    });
    const validated = decision.orders[0];
    const finding = validated.findings.find((f) => f.code === 'UNVERIFIED_POSITION')!;
    expect(finding.severity).toBe('block');
    expect(finding.message).toContain('SIMULATED');
    expect(validated.allowedNotional).toBe(0);
    expect(validated.approved).toBe(false);
  });
});
