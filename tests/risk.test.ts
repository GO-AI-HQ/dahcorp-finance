import { describe, expect, it } from 'vitest';
import type { StrategyConfig } from '../src/core/config.js';
import { DEFAULT_STRATEGY_CONFIG } from '../src/core/config.js';
import { analyzePortfolio } from '../src/core/portfolio.js';
import { buildIncomeSummary } from '../src/core/income.js';
import type { RiskContext } from '../src/risk/engine.js';
import { orderKey, validateAllocation, validateOrders } from '../src/risk/engine.js';
import type { ProposedOrder } from '../src/risk/types.js';
import type { Holding } from '../src/core/types.js';
import { AS_OF, flatBars, makeAccount, makeHolding, makeSnapshot, quotesFor, steadyWeekly } from './helpers.js';

/**
 * The deterministic policy / risk engine.
 *
 *   Claude → Recommendation → RISK ENGINE → Trade Preview → Human Approval
 *
 * Claude is never a party to these tests, which is the point: the engine reads
 * only the portfolio, the quotes and the stored config, and a `block` finding
 * has no override path.
 */
const BIG_ORDERS: StrategyConfig = { ...DEFAULT_STRATEGY_CONFIG, maxOrderNotional: 1_000_000 };

function context(
  parts: {
    cash?: number;
    holdings?: Holding[];
    prices?: Record<string, number>;
    config?: StrategyConfig;
    tradeEligible?: boolean;
    allocationEligible?: boolean;
    recentOrderKeys?: string[];
    withIncome?: boolean;
  } = {},
): RiskContext {
  const config = parts.config ?? DEFAULT_STRATEGY_CONFIG;
  const snapshot = makeSnapshot({
    accounts: [
      makeAccount('sch-1', {
        broker: 'schwab',
        name: 'Income / Value / Cyclical',
        cash: parts.cash ?? 20_000,
        tradeEligible: parts.tradeEligible ?? true,
        allocationEligible: parts.allocationEligible ?? true,
      }),
    ],
    holdings: parts.holdings ?? [],
    quotes: quotesFor(parts.prices ?? { NVDY: 12.5, YMAG: 11.12, QQQI: 50, SPYI: 50, NVDA: 100, SOXL: 30 }),
    distributions: parts.withIncome ? steadyWeekly('NVDY', 0.2, 52) : [],
    priceHistory: parts.withIncome ? { NVDY: flatBars(12.5, 200) } : {},
  });
  const analysis = analyzePortfolio(snapshot, config);
  return {
    asOf: AS_OF,
    analysis,
    income: parts.withIncome ? buildIncomeSummary(snapshot, analysis, config) : null,
    quotes: snapshot.quotes,
    config,
    recentOrderKeys: parts.recentOrderKeys,
  };
}

function makeOrder(over: Partial<ProposedOrder> = {}): ProposedOrder {
  return {
    id: over.id ?? 'o1',
    accountId: 'sch-1',
    broker: 'schwab',
    symbol: 'NVDY',
    side: 'buy',
    notional: 1_000,
    orderType: 'market',
    rationale: 'Income engine accumulation.',
    origin: 'claude',
    sleeve: 'income_engine',
    ...over,
  };
}

describe('orderKey', () => {
  it('is stable for the same order and distinct for a different size', () => {
    const order = makeOrder();
    expect(orderKey(order)).toBe(orderKey({ ...order, id: 'other', rationale: 'different words' }));
    expect(orderKey(order)).not.toBe(orderKey({ ...order, notional: 1_001 }));
    expect(orderKey(order)).not.toBe(orderKey({ ...order, side: 'sell' }));
    expect(orderKey({ ...order, notional: undefined, quantity: 3 })).toContain('q3.0000');
  });
});

describe('execution gating', () => {
  it('never reports execution as enabled, in any configured phase', () => {
    for (const phase of [1, 2, 3, 4, 5] as const) {
      const decision = validateOrders([makeOrder()], context({ config: { ...DEFAULT_STRATEGY_CONFIG, executionPhase: phase } }));
      expect(decision.executionEnabled).toBe(false);
      expect(decision.executionPhase).toBe(phase);
      expect(decision.findings.find((f) => f.code === 'EXECUTION_PHASE')!.message).toContain('disabled in this build');
    }
  });

  it('blocks the whole batch when the kill switch is engaged', () => {
    const decision = validateOrders([makeOrder()], context({ config: { ...DEFAULT_STRATEGY_CONFIG, killSwitch: true } }));
    expect(decision.approved).toBe(false);
    expect(decision.findings.some((f) => f.code === 'KILL_SWITCH' && f.severity === 'block')).toBe(true);
    // An otherwise perfectly compliant order is still zeroed — there is no
    // override path through the engine.
    expect(decision.orders[0].approved).toBe(false);
    expect(decision.orders[0].allowedNotional).toBe(0);
    expect(decision.allowedTotal).toBe(0);
  });
});

describe('a compliant order', () => {
  const decision = validateOrders([makeOrder()], context({ withIncome: true }));
  const validated = decision.orders[0];

  it('is approved at the requested size', () => {
    expect(decision.approved).toBe(true);
    expect(validated.approved).toBe(true);
    expect(validated.allowedNotional).toBe(1_000);
    expect(decision.requestedTotal).toBe(1_000);
    expect(decision.allowedTotal).toBe(1_000);
  });

  it('sizes shares from the quote', () => {
    expect(validated.estimatedPrice).toBe(12.5);
    expect(validated.estimatedShares).toBeCloseTo(80, 10);
  });

  it('still labels mock pricing as a planning artifact', () => {
    const mock = validated.findings.find((f) => f.code === 'MOCK_QUOTE')!;
    expect(mock.severity).toBe('warning');
    expect(mock.message).toContain('planning artifact');
  });

  it('reports the portfolio impact of the allowed size', () => {
    expect(validated.impact.postTradeCash).toBe(19_000);
    expect(validated.impact.postTradeWeight).toBeCloseTo(1_000 / 20_000, 10);
    expect(validated.impact.postTradeLeveragedPct).toBe(0);
  });

  it('credits income using the instrument’s own rate, not a blended one', () => {
    const held = context({ withIncome: true, holdings: [makeHolding('sch-1', 'NVDY', 10, 12)] });
    const priced = validateOrders([makeOrder()], held).orders[0];
    // NVDY models $0.20/week per share on a $12.50 price → 83.2% annualised.
    const rate = (0.2 * 52) / 12.5;
    expect(priced.impact.forwardMonthlyIncomeDelta).toBeCloseTo((1_000 * rate) / 12, 8);
  });

  it('reports a null income delta for an instrument with no modeled rate', () => {
    const held = context({ withIncome: true, holdings: [makeHolding('sch-1', 'NVDY', 10, 12)] });
    const other = validateOrders([makeOrder({ symbol: 'SPYI' })], held).orders[0];
    expect(other.impact.forwardMonthlyIncomeDelta).toBeNull();
  });
});

describe('household liquidity vs brokerage cash', () => {
  it('approves a contribution while the household reserve is underfunded, and says so', () => {
    // The household target is $10,000 and the household holds nothing. Under
    // the old conflated reserve this order was blocked outright, because the
    // reserve was measured against brokerage cash.
    const decision = validateOrders([makeOrder({ notional: 500 })], context({ cash: 20_000 }));
    expect(decision.approved).toBe(true);
    expect(decision.orders[0].allowedNotional).toBe(500);
    const warning = decision.findings.find((f) => f.code === 'EXTERNAL_RESERVE_UNDERFUNDED')!;
    expect(warning.severity).toBe('warning');
    expect(warning.message).toContain('external reserve target');
    expect(decision.findings.some((f) => f.severity === 'block')).toBe(false);
  });

  it('stops warning once the household reserve is funded', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 500 })],
      context({ cash: 20_000, config: { ...DEFAULT_STRATEGY_CONFIG, externalLiquidityCurrent: 10_000 } }),
    );
    expect(decision.findings.some((f) => f.code === 'EXTERNAL_RESERVE_UNDERFUNDED')).toBe(false);
    expect(decision.approved).toBe(true);
  });

  it('blocks any order that names the protected external reserve as its funding source', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 500, fundingSource: 'external_reserve' })],
      context({ cash: 20_000 }),
    );
    const finding = decision.findings.find((f) => f.code === 'EXTERNAL_RESERVE_DRAW')!;
    expect(finding.severity).toBe('block');
    expect(finding.message).toContain('never be drawn down');
    expect(decision.approved).toBe(false);
  });

  it('withholds only the settlement floor from deployable brokerage cash', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 1_000 })],
      context({ cash: 20_000, config: { ...DEFAULT_STRATEGY_CONFIG, brokerCashFloor: 19_500 } }),
    );
    // $20,000 cash less the $19,500 floor leaves $500, so the order is trimmed
    // rather than rejected.
    expect(decision.orders[0].allowedNotional).toBe(500);
    expect(decision.orders[0].findings.some((f) => f.code === 'CASH_LIMIT_REDUCED')).toBe(true);
    expect(decision.findings.some((f) => f.code === 'INSUFFICIENT_INVESTABLE_CASH')).toBe(true);
  });

  it('blocks when the settlement floor leaves nothing deployable', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 500 })],
      context({ cash: 20_000, config: { ...DEFAULT_STRATEGY_CONFIG, brokerCashFloor: 25_000 } }),
    );
    const order = decision.orders[0];
    expect(order.allowedNotional).toBe(0);
    const finding = order.findings.find((f) => f.code === 'NO_INVESTABLE_CASH')!;
    expect(finding.severity).toBe('block');
    // The reserve is never offered as the way out.
    expect(finding.message).toContain('external reserve is not an available funding source');
  });

  it('reduces later orders in a batch as earlier ones consume cash', () => {
    const decision = validateOrders(
      [
        makeOrder({ id: 'a', symbol: 'QQQI', notional: 6_000, sleeve: 'income_engine' }),
        makeOrder({ id: 'b', symbol: 'SPYI', notional: 6_000, sleeve: 'income_engine' }),
      ],
      context({ cash: 20_000, config: { ...BIG_ORDERS, brokerCashFloor: 10_000 } }),
    );
    // $10,000 deployable after the settlement floor: the first order takes
    // $6,000, the second is cut to the $4,000 that remains, and the batch is
    // blocked for over-requesting.
    expect(decision.orders[0].allowedNotional).toBe(6_000);
    expect(decision.orders[1].allowedNotional).toBe(4_000);
    expect(decision.orders[1].findings.some((f) => f.code === 'CASH_LIMIT_REDUCED')).toBe(true);
    expect(decision.findings.some((f) => f.code === 'INSUFFICIENT_INVESTABLE_CASH')).toBe(true);
    expect(decision.approved).toBe(false);
  });
});

describe('account eligibility', () => {
  it('blocks an order against an account that is not in the snapshot', () => {
    const decision = validateOrders([makeOrder({ accountId: 'ghost' })], context());
    expect(decision.orders[0].findings.some((f) => f.code === 'UNKNOWN_ACCOUNT' && f.severity === 'block')).toBe(true);
    expect(decision.orders[0].allowedNotional).toBe(0);
  });

  it('excludes retirement and education accounts from automated allocation', () => {
    const decision = validateOrders([makeOrder()], context({ allocationEligible: false }));
    const finding = decision.orders[0].findings.find((f) => f.code === 'ACCOUNT_NOT_ALLOCATION_ELIGIBLE')!;
    expect(finding.severity).toBe('block');
    expect(finding.message).toContain('Roth IRA and education accounts');
  });

  it('allows a preview but blocks placement for an account that is not trade-eligible', () => {
    const decision = validateOrders([makeOrder()], context({ tradeEligible: false }));
    const finding = decision.orders[0].findings.find((f) => f.code === 'ACCOUNT_NOT_TRADE_ELIGIBLE')!;
    expect(finding.severity).toBe('block');
    expect(finding.message).toContain('previewed for planning but never placed');
    expect(decision.orders[0].approved).toBe(false);
  });
});

describe('pricing and duplicates', () => {
  it('will not size an order without a usable quote', () => {
    const decision = validateOrders([makeOrder({ symbol: 'CHPY' })], context());
    expect(decision.orders[0].findings.some((f) => f.code === 'NO_PRICE' && f.severity === 'block')).toBe(true);
    expect(decision.orders[0].estimatedShares).toBeNull();
  });

  it('blocks an order equivalent to one already submitted', () => {
    const order = makeOrder();
    const decision = validateOrders([order], context({ recentOrderKeys: [orderKey(order)] }));
    expect(decision.orders[0].findings.some((f) => f.code === 'DUPLICATE_ORDER' && f.severity === 'block')).toBe(true);
  });

  it('blocks the second of two identical orders in the same batch', () => {
    const decision = validateOrders([makeOrder({ id: 'a' }), makeOrder({ id: 'b' })], context());
    expect(decision.orders[0].approved).toBe(true);
    expect(decision.orders[1].findings.some((f) => f.code === 'DUPLICATE_IN_BATCH')).toBe(true);
    expect(decision.orders[1].allowedNotional).toBe(0);
  });
});

describe('sizing limits', () => {
  it('caps a single order at the configured maximum notional', () => {
    const decision = validateOrders([makeOrder({ symbol: 'QQQI', notional: 9_000 })], context({ cash: 40_000 }));
    const finding = decision.orders[0].findings.find((f) => f.code === 'ORDER_SIZE_REDUCED')!;
    expect(finding.limit).toBe(2_500);
    expect(decision.orders[0].allowedNotional).toBe(2_500);
    expect(decision.orders[0].approved).toBe(true);
  });

  it('reduces a buy that would breach the single-position ceiling', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 6_000 })],
      context({ cash: 30_000, holdings: [makeHolding('sch-1', 'NVDY', 800, 12.5)], config: BIG_ORDERS }),
    );
    // $10,000 of NVDY in a $40,000 portfolio; the 35% ceiling is $14,000.
    const finding = decision.orders[0].findings.find((f) => f.code === 'POSITION_LIMIT_REDUCED')!;
    expect(finding.limit).toBe(0.35);
    expect(decision.orders[0].allowedNotional).toBeCloseTo(4_000, 6);
  });

  it('blocks a buy in a position already at the ceiling', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 1_000 })],
      context({ cash: 30_000, holdings: [makeHolding('sch-1', 'NVDY', 1_400, 12.5)], config: BIG_ORDERS }),
    );
    // $17,500 of NVDY in a $47,500 portfolio is already past the 35% ceiling.
    expect(decision.orders[0].findings.some((f) => f.code === 'POSITION_LIMIT_BLOCK' && f.severity === 'block')).toBe(true);
    expect(decision.orders[0].allowedNotional).toBe(0);
  });

  it('treats NVDY and NVDA as the same underlying bet', () => {
    const decision = validateOrders(
      [makeOrder({ notional: 5_000 })],
      context({
        cash: 30_000,
        holdings: [makeHolding('sch-1', 'NVDY', 800, 12.5), makeHolding('sch-1', 'NVDA', 80, 100)],
        config: BIG_ORDERS,
      }),
    );
    // $18,000 of NVDA exposure in a $48,000 portfolio; the 45% ceiling is
    // $21,600, so only $3,600 more may be added.
    const finding = decision.orders[0].findings.find((f) => f.code === 'EXPOSURE_LIMIT_REDUCED')!;
    expect(finding.message).toContain('NVDA');
    expect(decision.orders[0].allowedNotional).toBeCloseTo(3_600, 6);
  });
});

describe('leveraged sleeve', () => {
  it('reduces a leveraged buy to the configured sleeve ceiling', () => {
    const decision = validateOrders(
      [makeOrder({ symbol: 'SOXL', notional: 5_000, sleeve: 'tactical_leveraged' })],
      context({
        cash: 30_000,
        holdings: [makeHolding('sch-1', 'SOXL', 100, 30)],
        prices: { SOXL: 30 },
        config: BIG_ORDERS,
      }),
    );
    // $3,000 of SOXL in a $33,000 portfolio; the 10% ceiling is $3,300.
    const finding = decision.orders[0].findings.find((f) => f.code === 'LEVERAGE_LIMIT_REDUCED')!;
    expect(finding.limit).toBe(0.1);
    expect(decision.orders[0].allowedNotional).toBeCloseTo(300, 6);
  });

  it('blocks a leveraged buy once the sleeve is at its ceiling — no quiet override', () => {
    const decision = validateOrders(
      [makeOrder({ symbol: 'SOXL', notional: 1_000, sleeve: 'tactical_leveraged' })],
      context({
        cash: 30_000,
        holdings: [makeHolding('sch-1', 'SOXL', 200, 30)],
        prices: { SOXL: 30 },
        config: BIG_ORDERS,
      }),
    );
    const finding = decision.orders[0].findings.find((f) => f.code === 'LEVERAGE_LIMIT_BLOCK')!;
    expect(finding.severity).toBe('block');
    expect(finding.message).toContain('explicit configuration change');
    expect(decision.orders[0].allowedNotional).toBe(0);
  });

  it('permits more leverage only when the ceiling itself is raised', () => {
    const raised = validateOrders(
      [makeOrder({ symbol: 'SOXL', notional: 1_000, sleeve: 'tactical_leveraged' })],
      context({
        cash: 30_000,
        holdings: [makeHolding('sch-1', 'SOXL', 200, 30)],
        prices: { SOXL: 30 },
        config: { ...BIG_ORDERS, maxLeveragedSleevePct: 0.3, sleeveCeilings: { tactical_leveraged: 0.3 } },
      }),
    );
    expect(raised.orders[0].approved).toBe(true);
    expect(raised.orders[0].allowedNotional).toBe(1_000);
    expect(raised.orders[0].impact.postTradeLeveragedPct).toBeCloseTo(7_000 / 36_000, 8);
  });
});

describe('sells', () => {
  it('cannot sell a position that is not held', () => {
    const decision = validateOrders([makeOrder({ side: 'sell', notional: undefined, quantity: 5 })], context());
    expect(decision.orders[0].findings.some((f) => f.code === 'NO_POSITION' && f.severity === 'block')).toBe(true);
    expect(decision.orders[0].allowedNotional).toBe(0);
  });

  it('reduces a sell to the shares actually held', () => {
    const decision = validateOrders(
      [makeOrder({ side: 'sell', notional: undefined, quantity: 20 })],
      context({ holdings: [makeHolding('sch-1', 'NVDY', 10, 12)] }),
    );
    const finding = decision.orders[0].findings.find((f) => f.code === 'SELL_SIZE_REDUCED')!;
    expect(finding.limit).toBe(10);
    expect(decision.orders[0].allowedNotional).toBeCloseTo(125, 8);
    expect(decision.orders[0].approved).toBe(true);
    // Sell proceeds are not counted as capital deployed.
    expect(decision.allowedTotal).toBe(0);
  });

  it('adds sell proceeds to projected cash', () => {
    const decision = validateOrders(
      [makeOrder({ side: 'sell', notional: undefined, quantity: 10 })],
      context({ cash: 1_000, holdings: [makeHolding('sch-1', 'NVDY', 10, 12)] }),
    );
    expect(decision.orders[0].impact.postTradeCash).toBeCloseTo(1_125, 8);
  });
});

describe('validateAllocation', () => {
  it('validates a recommended allocation leg by leg before any order exists', () => {
    const decision = validateAllocation(
      [
        { symbol: 'NVDY', amount: 1_000, accountId: 'sch-1', sleeve: 'income_engine' },
        { symbol: 'YMAG', amount: 1_000, accountId: 'sch-1', sleeve: 'income_engine' },
      ],
      context(),
    );
    expect(decision.orders).toHaveLength(2);
    expect(decision.orders.every((o) => o.order.origin === 'claude')).toBe(true);
    expect(decision.orders.every((o) => o.order.side === 'buy')).toBe(true);
    expect(decision.allowedTotal).toBe(2_000);
    expect(decision.approved).toBe(true);
  });

  it('applies the same limits to a recommendation as to a manual order', () => {
    const decision = validateAllocation(
      [{ symbol: 'SOXL', amount: 5_000, accountId: 'sch-1', sleeve: 'tactical_leveraged' }],
      context({ cash: 30_000, prices: { SOXL: 30 }, config: BIG_ORDERS }),
    );
    // 10% of a $30,000 portfolio is $3,000, so a $5,000 recommendation is cut.
    expect(decision.orders[0].allowedNotional).toBeCloseTo(3_000, 6);
    expect(decision.orders[0].findings.some((f) => f.code === 'LEVERAGE_LIMIT_REDUCED')).toBe(true);
  });

  it('marks an unknown account on a recommended leg rather than routing it anywhere', () => {
    const decision = validateAllocation(
      [{ symbol: 'NVDY', amount: 500, accountId: 'roth-1', sleeve: 'income_engine' }],
      context(),
    );
    expect(decision.orders[0].order.broker).toBe('manual');
    expect(decision.orders[0].findings.some((f) => f.code === 'UNKNOWN_ACCOUNT')).toBe(true);
    expect(decision.approved).toBe(false);
  });
});
