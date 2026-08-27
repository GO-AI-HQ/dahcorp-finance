import type { StrategyConfig } from '../core/config.js';
import type { Quote } from '../core/types.js';
import { safeDiv } from '../core/math.js';
import { getInstrumentOrFallback } from '../core/universe.js';
import type { PortfolioAnalysis, ScopeView } from '../core/portfolio.js';
import { riskScopeFor, type RiskRuleKind } from '../core/scope.js';
import type { IncomeSummary } from '../core/income.js';
import type { ProposedOrder, RiskDecision, RiskFinding, ValidatedOrder } from './types.js';

/**
 * Deterministic policy / risk engine.
 *
 * This is the only component permitted to decide whether capital may move. It
 * runs after Claude and cannot be influenced by Claude's output: it reads the
 * portfolio, the quotes and the stored StrategyConfig, and nothing else.
 *
 *   Claude → Recommendation → THIS → Trade Preview → Human Approval → Broker
 *
 * A `block` finding is final. There is no override path through the API; the
 * only way to change the outcome is for a human to change the stored config.
 */

/** Environments where execution could ever be permitted. Phase 1 permits none. */
const EXECUTION_ENABLED_PHASES: number[] = [];

function block(code: string, message: string, limit?: number, actual?: number): RiskFinding {
  return { code, severity: 'block', message, limit, actual };
}
function warn(code: string, message: string, limit?: number, actual?: number): RiskFinding {
  return { code, severity: 'warning', message, limit, actual };
}
function info(code: string, message: string): RiskFinding {
  return { code, severity: 'info', message };
}

export interface RiskContext {
  asOf: string;
  analysis: PortfolioAnalysis;
  income: IncomeSummary | null;
  quotes: Record<string, Quote>;
  config: StrategyConfig;
  /** Orders already submitted recently, for duplicate detection. */
  recentOrderKeys?: string[];
}

/** Stable key used to detect a duplicate of an order already in flight. */
export function orderKey(order: ProposedOrder): string {
  const size = order.notional != null ? `n${order.notional.toFixed(2)}` : `q${(order.quantity ?? 0).toFixed(4)}`;
  return [order.accountId, order.symbol.toUpperCase(), order.side, size].join('|');
}

export function validateOrders(orders: ProposedOrder[], ctx: RiskContext): RiskDecision {
  const { analysis, config, quotes } = ctx;
  const batchFindings: RiskFinding[] = [];

  const killSwitchOn = config.killSwitch;
  if (killSwitchOn) {
    batchFindings.push(block('KILL_SWITCH', 'Global kill switch is engaged. No order may be previewed or executed.'));
  }

  const executionEnabled = EXECUTION_ENABLED_PHASES.includes(config.executionPhase);
  batchFindings.push(
    info(
      'EXECUTION_PHASE',
      `Execution phase ${config.executionPhase}. Live order placement is disabled in this build regardless of phase.`,
    ),
  );

  const buys = orders.filter((o) => o.side === 'buy');
  const requestedBuyNotional = buys.reduce((acc, o) => acc + (o.notional ?? 0), 0);

  // ── Cash check. Only brokerage cash can fund a brokerage order; the
  // household reserve lives outside the brokerages and is never counted here,
  // in either direction. Being under the household target is a warning, not a
  // block, so planned contributions can still be analysed and allocated.
  const deployable = analysis.totals.deployableBrokerCash;
  if (requestedBuyNotional > deployable) {
    batchFindings.push(
      block(
        'INSUFFICIENT_INVESTABLE_CASH',
        `Requested buys total $${requestedBuyNotional.toFixed(2)} but only $${deployable.toFixed(2)} of brokerage cash is deployable in allocation-eligible accounts after the $${config.brokerCashFloor.toFixed(0)} settlement floor.`,
        deployable,
        requestedBuyNotional,
      ),
    );
  }
  if (analysis.totals.externalReserveUnderfunded) {
    batchFindings.push(
      warn(
        'EXTERNAL_RESERVE_UNDERFUNDED',
        `Household liquidity of $${analysis.totals.externalLiquidityCurrent.toFixed(2)} is $${analysis.totals.externalLiquidityGap.toFixed(2)} below the $${analysis.totals.externalLiquidityTarget.toFixed(0)} external reserve target. Contributions may still be allocated, but restoring the reserve should take priority over increasing investment pace.`,
        analysis.totals.externalLiquidityTarget,
        analysis.totals.externalLiquidityCurrent,
      ),
    );
  }
  const reserveFunded = orders.filter((o) => o.fundingSource === 'external_reserve');
  if (reserveFunded.length) {
    batchFindings.push(
      block(
        'EXTERNAL_RESERVE_DRAW',
        `${reserveFunded.length} order${reserveFunded.length === 1 ? '' : 's'} declare the protected external reserve as their funding source. The household reserve may never be drawn down to fund investment.`,
      ),
    );
  }

  /**
   * The scope a risk limit is measured in — see `riskScopeFor`. Numerators and
   * denominators both use *confirmed* capital only, so a simulated fixture can
   * demonstrate the arithmetic without gating a real recommendation.
   */
  const viewFor = (kind: RiskRuleKind, accountType: PortfolioAnalysis['positions'][number]['accountType']): ScopeView =>
    analysis.scopes[riskScopeFor(kind, accountType, config.wholePortfolioRules)];
  const confirmedIn = (view: ScopeView) => view.positions.filter((p) => p.verified);

  const seenKeys = new Set(ctx.recentOrderKeys ?? []);
  const batchKeys = new Set<string>();

  // Running totals so a batch is validated as a whole, not order by order.
  const leverageBaseline = viewFor('sleeve', 'taxable');
  let runningLeveragedValue = confirmedIn(leverageBaseline)
    .filter((p) => p.leverage > 1)
    .reduce((acc, p) => acc + p.marketValue, 0);
  let runningCash = analysis.totals.totalCash;
  let runningDeployableCash = deployable;
  let runningTotalValue = analysis.totals.totalValue;

  const validated: ValidatedOrder[] = orders.map((order) => {
    const findings: RiskFinding[] = [];
    const symbol = order.symbol.toUpperCase();
    const instrument = getInstrumentOrFallback(symbol);
    const quote = quotes[symbol];
    const price = quote?.price ?? null;

    const account = analysis.accounts.find((a) => a.account.id === order.accountId)?.account;
    const position = analysis.positions.find((p) => p.symbol === symbol && p.holding.accountId === order.accountId);

    let requested =
      order.notional != null
        ? order.notional
        : order.quantity != null && price != null
          ? order.quantity * price
          : 0;
    let allowed = Math.max(0, requested);

    // ── Account eligibility.
    if (!account) {
      findings.push(block('UNKNOWN_ACCOUNT', `Account ${order.accountId} is not present in the portfolio snapshot.`));
      allowed = 0;
    } else {
      if (order.side === 'buy' && !account.allocationEligible) {
        findings.push(
          block(
            'ACCOUNT_NOT_ALLOCATION_ELIGIBLE',
            `${account.name} is not eligible for new capital allocation. Roth IRA and education accounts are excluded from automated allocation.`,
          ),
        );
        allowed = 0;
      }
      if (!account.tradeEligible) {
        findings.push(
          block(
            'ACCOUNT_NOT_TRADE_ELIGIBLE',
            `${account.name} is not trade-eligible. Orders may be previewed for planning but never placed.`,
          ),
        );
      }
    }

    // ── Price availability. Without a price nothing can be sized safely.
    if (price == null || price <= 0) {
      findings.push(block('NO_PRICE', `No usable quote for ${symbol}. Cannot size an order.`));
      allowed = 0;
    }
    if (quote && quote.dataQuality === 'mock') {
      findings.push(
        warn('MOCK_QUOTE', `${symbol} is priced from mock fixture data. This order is a planning artifact only.`),
      );
    }
    if (quote && quote.dataQuality === 'stale') {
      findings.push(warn('STALE_QUOTE', `${symbol} quote is stale.`));
    }

    // ── Duplicate detection.
    const key = orderKey(order);
    if (seenKeys.has(key)) {
      findings.push(block('DUPLICATE_ORDER', `An equivalent order for ${symbol} was already submitted recently.`));
      allowed = 0;
    }
    if (batchKeys.has(key)) {
      findings.push(block('DUPLICATE_IN_BATCH', `This batch contains two identical ${symbol} orders.`));
      allowed = 0;
    }
    batchKeys.add(key);

    // ── Maximum trade size.
    if (allowed > config.maxOrderNotional) {
      findings.push(
        warn(
          'ORDER_SIZE_REDUCED',
          `Order reduced from $${allowed.toFixed(2)} to the configured maximum single-order size of $${config.maxOrderNotional.toFixed(0)}.`,
          config.maxOrderNotional,
          allowed,
        ),
      );
      allowed = config.maxOrderNotional;
    }

    const accountType = account?.type ?? 'taxable';

    if (order.side === 'buy') {
      // ── Single-position concentration, measured in the risk scope.
      const positionScopeView = viewFor('concentration', accountType);
      const symbolTotal = confirmedIn(positionScopeView)
        .filter((p) => p.symbol === symbol)
        .reduce((acc, p) => acc + p.marketValue, 0);
      // A buy converts cash to position value, so the denominator is unchanged.
      const projectedTotalValue = positionScopeView.verifiedTotalValue;
      const maxPositionValue = projectedTotalValue * config.maxSinglePositionPct;
      if (symbolTotal + allowed > maxPositionValue) {
        const reduced = Math.max(0, maxPositionValue - symbolTotal);
        findings.push(
          reduced > 0
            ? warn(
                'POSITION_LIMIT_REDUCED',
                `Order reduced to $${reduced.toFixed(2)} to keep ${symbol} within the ${(config.maxSinglePositionPct * 100).toFixed(0)}% single-position ceiling.`,
                config.maxSinglePositionPct,
                safeDiv(symbolTotal + allowed, projectedTotalValue),
              )
            : block(
                'POSITION_LIMIT_BLOCK',
                `${symbol} is already at or above the ${(config.maxSinglePositionPct * 100).toFixed(0)}% single-position ceiling.`,
                config.maxSinglePositionPct,
                safeDiv(symbolTotal, projectedTotalValue),
              ),
        );
        allowed = Math.min(allowed, reduced);
      }

      // ── Underlying-exposure concentration. NVDY and NVDA are the same bet.
      const exposureScopeView = viewFor('exposure', accountType);
      const exposureValue = confirmedIn(exposureScopeView)
        .filter((p) => p.exposure === instrument.exposure)
        .reduce((acc, p) => acc + p.marketValue, 0);
      const exposureTotalValue = exposureScopeView.verifiedTotalValue;
      const maxExposureValue = exposureTotalValue * config.maxSingleExposurePct;
      if (exposureValue + allowed > maxExposureValue) {
        const reduced = Math.max(0, maxExposureValue - exposureValue);
        findings.push(
          reduced > 0
            ? warn(
                'EXPOSURE_LIMIT_REDUCED',
                `Order reduced to $${reduced.toFixed(2)} to keep total ${instrument.exposure.toUpperCase()} exposure within ${(config.maxSingleExposurePct * 100).toFixed(0)}%.`,
                config.maxSingleExposurePct,
                safeDiv(exposureValue + allowed, exposureTotalValue),
              )
            : block(
                'EXPOSURE_LIMIT_BLOCK',
                `Underlying exposure to ${instrument.exposure.toUpperCase()} is already at the ${(config.maxSingleExposurePct * 100).toFixed(0)}% ceiling.`,
                config.maxSingleExposurePct,
                safeDiv(exposureValue, exposureTotalValue),
              ),
        );
        allowed = Math.min(allowed, reduced);
      }

      // ── Leveraged sleeve ceiling. This is the check that stops a
      // recommendation from quietly pushing SOXL + TSMX past the limit.
      const sleeveScopeView = viewFor('sleeve', accountType);
      const sleeveTotalValue = sleeveScopeView.verifiedTotalValue;
      if (instrument.leverage > 1) {
        const maxLeveragedValue = sleeveTotalValue * config.maxLeveragedSleevePct;
        if (runningLeveragedValue + allowed > maxLeveragedValue) {
          const reduced = Math.max(0, maxLeveragedValue - runningLeveragedValue);
          findings.push(
            reduced > 0
              ? warn(
                  'LEVERAGE_LIMIT_REDUCED',
                  `Order reduced to $${reduced.toFixed(2)} to keep the leveraged sleeve within ${(config.maxLeveragedSleevePct * 100).toFixed(0)}% of portfolio value.`,
                  config.maxLeveragedSleevePct,
                  safeDiv(runningLeveragedValue + allowed, sleeveTotalValue),
                )
              : block(
                  'LEVERAGE_LIMIT_BLOCK',
                  `The leveraged sleeve is at the configured ceiling of ${(config.maxLeveragedSleevePct * 100).toFixed(0)}%. No further ${symbol} purchase is permitted without an explicit configuration change.`,
                  config.maxLeveragedSleevePct,
                  safeDiv(runningLeveragedValue, sleeveTotalValue),
                ),
          );
          allowed = Math.min(allowed, reduced);
        }
      }

      // ── Sleeve ceilings.
      const sleeveCeiling = config.sleeveCeilings[order.sleeve];
      if (sleeveCeiling != null) {
        const sleeveValue = confirmedIn(sleeveScopeView)
          .filter((p) => p.sleeve === order.sleeve)
          .reduce((acc, p) => acc + p.marketValue, 0);
        const maxSleeveValue = sleeveTotalValue * sleeveCeiling;
        if (sleeveValue + allowed > maxSleeveValue) {
          const reduced = Math.max(0, maxSleeveValue - sleeveValue);
          findings.push(
            warn(
              'SLEEVE_LIMIT_REDUCED',
              `Order reduced to $${reduced.toFixed(2)} to respect the ${(sleeveCeiling * 100).toFixed(0)}% ceiling on the ${order.sleeve.replace(/_/g, ' ')} sleeve.`,
              sleeveCeiling,
              safeDiv(sleeveValue + allowed, sleeveTotalValue),
            ),
          );
          allowed = Math.min(allowed, reduced);
        }
      }

      // ── Deployable brokerage cash, applied cumulatively across the batch.
      const availableNow = Math.max(0, runningDeployableCash);
      if (allowed > availableNow) {
        findings.push(
          availableNow > 0
            ? warn(
                'CASH_LIMIT_REDUCED',
                `Order reduced to $${availableNow.toFixed(2)} — the brokerage cash remaining after the settlement floor and earlier orders in this batch.`,
                availableNow,
                allowed,
              )
            : block(
                'NO_INVESTABLE_CASH',
                `No deployable brokerage cash remains after the $${config.brokerCashFloor.toFixed(0)} settlement floor and earlier orders in this batch. The protected external reserve is not an available funding source.`,
                0,
                allowed,
              ),
        );
        allowed = Math.max(0, Math.min(allowed, availableNow));
      }

      runningCash -= allowed;
      runningDeployableCash -= allowed;
      if (instrument.leverage > 1) runningLeveragedValue += allowed;
    } else {
      // ── Sells: cannot sell more than is held, and never an unverified lot.
      const heldShares = position?.shares ?? 0;
      if (position && !position.verified) {
        findings.push(
          block(
            'UNVERIFIED_POSITION',
            `${symbol} in ${account?.name ?? order.accountId} is ${position.verification}. An unverified holding cannot be sold or harvested until a brokerage adapter confirms ownership and cost basis.`,
          ),
        );
        allowed = 0;
      }
      const requestedShares = order.quantity ?? (price ? allowed / price : 0);
      if (heldShares <= 0) {
        findings.push(block('NO_POSITION', `No ${symbol} position held in this account to sell.`));
        allowed = 0;
      } else if (requestedShares > heldShares + 1e-9) {
        findings.push(
          warn(
            'SELL_SIZE_REDUCED',
            `Sell reduced from ${requestedShares.toFixed(4)} to the ${heldShares.toFixed(4)} shares actually held.`,
            heldShares,
            requestedShares,
          ),
        );
        allowed = heldShares * (price ?? 0);
      }
      runningCash += allowed;
      runningDeployableCash += account?.allocationEligible ? allowed : 0;
      if (instrument.leverage > 1) runningLeveragedValue = Math.max(0, runningLeveragedValue - allowed);
    }

    if (killSwitchOn) findings.push(block('KILL_SWITCH', 'Kill switch engaged — order not approved.'));

    const blocked = findings.some((f) => f.severity === 'block');
    const finalAllowed = blocked ? 0 : allowed;

    // ── Portfolio impact of the allowed size.
    const symbolTotalAfter =
      analysis.positions.filter((p) => p.symbol === symbol).reduce((acc, p) => acc + p.marketValue, 0) +
      (order.side === 'buy' ? finalAllowed : -finalAllowed);
    const sleeveValueAfter =
      (analysis.sleeves.find((s) => s.sleeve === order.sleeve)?.marketValue ?? 0) +
      (order.side === 'buy' ? finalAllowed : -finalAllowed);

    // Income impact uses the position's own modeled distribution rate, so a
    // buy in a low-rate instrument is not credited with a blended rate.
    const incomePosition = ctx.income?.positions.find((p) => p.symbol === symbol);
    const rate = incomePosition?.distributionRate ?? null;
    const forwardMonthlyIncomeDelta =
      rate != null ? ((order.side === 'buy' ? finalAllowed : -finalAllowed) * rate) / 12 : null;

    return {
      order,
      approved: !blocked && finalAllowed > 0,
      allowedNotional: finalAllowed,
      estimatedShares: price && price > 0 ? finalAllowed / price : null,
      estimatedPrice: price,
      findings,
      impact: {
        postTradeWeight: safeDiv(symbolTotalAfter, runningTotalValue),
        postTradeSleeveWeight: safeDiv(sleeveValueAfter, runningTotalValue),
        postTradeLeveragedPct: safeDiv(runningLeveragedValue, runningTotalValue),
        postTradeCash: runningCash,
        forwardMonthlyIncomeDelta,
      },
    };
  });

  const allowedTotal = validated
    .filter((v) => v.order.side === 'buy')
    .reduce((acc, v) => acc + v.allowedNotional, 0);

  const batchBlocked = batchFindings.some((f) => f.severity === 'block');

  return {
    asOf: ctx.asOf,
    approved: !batchBlocked && validated.some((v) => v.approved),
    orders: validated,
    findings: batchFindings,
    allowedTotal,
    requestedTotal: requestedBuyNotional,
    executionPhase: config.executionPhase,
    executionEnabled,
  };
}

/**
 * Validate a recommended dollar allocation, before it is turned into orders.
 * Used by the analyze endpoint so Claude's brief is annotated with the
 * deterministic verdict on each leg.
 */
export function validateAllocation(
  legs: { symbol: string; amount: number; accountId: string; sleeve: ProposedOrder['sleeve'] }[],
  ctx: RiskContext,
): RiskDecision {
  return validateOrders(
    legs.map((leg, index) => ({
      id: `alloc-${index}-${leg.symbol}`,
      accountId: leg.accountId,
      broker: ctx.analysis.accounts.find((a) => a.account.id === leg.accountId)?.account.broker ?? 'manual',
      symbol: leg.symbol,
      side: 'buy' as const,
      notional: leg.amount,
      orderType: 'market' as const,
      rationale: 'Allocation leg proposed for validation.',
      origin: 'claude' as const,
      sleeve: leg.sleeve,
    })),
    ctx,
  );
}
