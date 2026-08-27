import type { PriceBar, Quote } from './types.js';
import type { HarvestRule, StrategyConfig } from './config.js';
import { safeDiv } from './math.js';
import { computeDipSignal, computeTrendSignal, positionDrawdown, type DipSignal, type TrendSignal } from './signals.js';
import type { PortfolioAnalysis, PositionView } from './portfolio.js';
import { getInstrumentOrFallback } from './universe.js';

/**
 * Semiconductor engine.
 *
 * Two permanent cores (TSM, SMH) and two daily-reset leveraged tactical
 * instruments (TSMX ~2x, SOXL ~3x). The tactical sleeve exists to be harvested
 * into the permanent cores, not to be held and DRIPed.
 *
 * Nothing here treats 2x or 3x daily leverage as 2x or 3x long-term return.
 * Volatility drag is computed and displayed explicitly.
 */
export interface HarvestSignal {
  symbol: string;
  destinationSymbol: string;
  enabled: boolean;
  held: boolean;
  shares: number;
  price: number;
  marketValue: number;
  /** Cost basis used for the harvest test. */
  tacticalCostBasis: number;
  tacticalCostBasisPerShare: number | null;
  unrealizedPL: number;
  gainPct: number | null;
  triggerGainPct: number;
  /** Price at which the harvest trigger arms. */
  triggerPrice: number | null;
  /** 0-1 progress from cost basis to the trigger. */
  progressToTrigger: number | null;
  armed: boolean;
  harvestPortionPct: number;
  /** Shares and dollars the rule would harvest right now. */
  harvestShares: number;
  harvestProceeds: number;
  trendStatus: TrendSignal['status'];
  drawdown: number;
  /** Description of the exact rule outcome, for the audit log. */
  ruleOutcome: string;
}

export interface LeveragedExposure {
  leveragedValue: number;
  leveragedPct: number;
  maxPct: number;
  /** Dollars of headroom before the configured ceiling. */
  headroom: number;
  overLimit: boolean;
  /** Weighted average daily leverage multiple of the sleeve. */
  weightedLeverage: number;
  positions: {
    symbol: string;
    leverage: number;
    marketValue: number;
    pctOfPortfolio: number;
    unrealizedPL: number;
    unrealizedPLPct: number | null;
    drawdown: number;
    trendStatus: TrendSignal['status'];
    /** Estimated annual volatility drag from daily rebalancing. */
    estimatedVolatilityDrag: number | null;
  }[];
}

export interface SemiconductorEngine {
  cores: {
    symbol: string;
    name: string;
    role: string;
    held: boolean;
    shares: number;
    price: number;
    marketValue: number;
    unrealizedPL: number;
    unrealizedPLPct: number | null;
    trend: TrendSignal;
    dip: DipSignal;
  }[];
  tactical: {
    symbol: string;
    name: string;
    leverage: number;
    destinationSymbol: string;
    held: boolean;
    shares: number;
    price: number;
    marketValue: number;
    tacticalCostBasis: number;
    unrealizedPL: number;
    unrealizedPLPct: number | null;
    trend: TrendSignal;
    dip: DipSignal;
    harvest: HarvestSignal;
    drawdown: number;
    estimatedVolatilityDrag: number | null;
    /** Signal that argues for reducing rather than adding. */
    riskReduction: RiskReductionSignal;
  }[];
  exposure: LeveragedExposure;
  /** The two flywheel legs, for the visualisation. */
  flywheel: { from: string; to: string; armed: boolean; proceeds: number }[];
}

export interface RiskReductionSignal {
  symbol: string;
  triggered: boolean;
  reasons: string[];
  recommendedAction: 'hold' | 'stop_adding' | 'reduce' | 'exit';
  /** Deterministic thresholds that produced the action. */
  detail: string;
}

/**
 * Estimated annual volatility drag on a daily-reset leveraged product.
 *
 * For leverage L and underlying annual volatility σ, the classic
 * continuous-time approximation of the drag is 0.5 × L × (L − 1) × σ².
 * This is an estimate of decay, not a prediction of price.
 */
export function estimateVolatilityDrag(leverage: number, underlyingAnnualVol: number | null): number | null {
  if (underlyingAnnualVol == null || leverage <= 1) return null;
  return 0.5 * leverage * (leverage - 1) * underlyingAnnualVol ** 2;
}

export function computeHarvestSignal(args: {
  rule: HarvestRule;
  position: PositionView | undefined;
  quote: Quote | undefined;
  trend: TrendSignal | null;
  bars: PriceBar[];
}): HarvestSignal {
  const { rule, position, quote, trend } = args;
  const price = quote?.price ?? position?.price ?? 0;
  const shares = position?.shares ?? 0;
  const marketValue = shares * price;
  const tacticalCostBasis = position?.tacticalCostBasisTotal ?? 0;
  const basisPerShare = shares > 0 && tacticalCostBasis > 0 ? tacticalCostBasis / shares : null;
  const unrealizedPL = marketValue - tacticalCostBasis;
  const gainPct = tacticalCostBasis > 0 ? unrealizedPL / tacticalCostBasis : null;
  const triggerPrice = basisPerShare != null ? basisPerShare * (1 + rule.triggerGainPct) : null;
  const progressToTrigger =
    gainPct != null && rule.triggerGainPct > 0 ? Math.max(0, gainPct) / rule.triggerGainPct : null;

  const armed = Boolean(rule.enabled && shares > 0 && gainPct != null && gainPct >= rule.triggerGainPct);
  const harvestShares = armed ? shares * rule.harvestPortionPct : 0;
  const harvestProceeds = harvestShares * price;

  const ruleOutcome = !rule.enabled
    ? `Rule disabled for ${rule.symbol}.`
    : shares <= 0
      ? `No ${rule.symbol} position held — harvest rule inactive.`
      : gainPct == null
        ? `No tactical cost basis recorded for ${rule.symbol} — cannot evaluate the +${(rule.triggerGainPct * 100).toFixed(0)}% trigger.`
        : armed
          ? `ARMED: ${rule.symbol} is +${(gainPct * 100).toFixed(1)}% vs tactical basis (trigger +${(rule.triggerGainPct * 100).toFixed(0)}%). Rule harvests ${(rule.harvestPortionPct * 100).toFixed(0)}% → ${rule.destinationSymbol}.`
          : `NOT ARMED: ${rule.symbol} is ${(gainPct * 100).toFixed(1)}% vs tactical basis; trigger is +${(rule.triggerGainPct * 100).toFixed(0)}%.`;

  return {
    symbol: rule.symbol,
    destinationSymbol: rule.destinationSymbol,
    enabled: rule.enabled,
    held: shares > 0,
    shares,
    price,
    marketValue,
    tacticalCostBasis,
    tacticalCostBasisPerShare: basisPerShare,
    unrealizedPL,
    gainPct,
    triggerGainPct: rule.triggerGainPct,
    triggerPrice,
    progressToTrigger,
    armed,
    harvestPortionPct: rule.harvestPortionPct,
    harvestShares,
    harvestProceeds,
    trendStatus: trend?.status ?? 'INSUFFICIENT_DATA',
    drawdown: positionDrawdown(args.bars),
    ruleOutcome,
  };
}

export function computeRiskReduction(args: {
  symbol: string;
  trend: TrendSignal;
  drawdown: number;
  config: StrategyConfig;
  overLeverageLimit: boolean;
}): RiskReductionSignal {
  const { symbol, trend, drawdown, config, overLeverageLimit } = args;
  const reasons: string[] = [];
  let action: RiskReductionSignal['recommendedAction'] = 'hold';

  if (trend.status === 'TREND_LOST') {
    reasons.push('Deterministic trend framework reports TREND LOST.');
    action = 'exit';
  } else if (trend.status === 'TREND_WEAKENING') {
    reasons.push('Deterministic trend framework reports TREND WEAKENING.');
    action = 'stop_adding';
  }

  if (drawdown >= config.trend.drawdownBreakPct) {
    reasons.push(`Drawdown of ${(drawdown * 100).toFixed(1)}% exceeds the configured break threshold of ${(config.trend.drawdownBreakPct * 100).toFixed(0)}%.`);
    action = action === 'exit' ? 'exit' : 'reduce';
  } else if (drawdown >= config.trend.drawdownWarnPct) {
    reasons.push(`Drawdown of ${(drawdown * 100).toFixed(1)}% exceeds the configured warning threshold of ${(config.trend.drawdownWarnPct * 100).toFixed(0)}%.`);
    if (action === 'hold') action = 'stop_adding';
  }

  if (overLeverageLimit) {
    reasons.push(`Leveraged sleeve exceeds the configured ceiling of ${(config.maxLeveragedSleevePct * 100).toFixed(0)}% of portfolio value.`);
    action = action === 'exit' ? 'exit' : 'reduce';
  }

  if (trend.rsi != null && trend.rsi > config.trend.rsiExtendedAbove) {
    reasons.push(`RSI of ${trend.rsi.toFixed(0)} is above the configured extended threshold — an unfavourable place to add leverage.`);
    if (action === 'hold') action = 'stop_adding';
  }

  return {
    symbol,
    triggered: action !== 'hold',
    reasons,
    recommendedAction: action,
    detail:
      action === 'hold'
        ? 'No deterministic risk-reduction trigger is currently met.'
        : `Deterministic rules recommend: ${action.replace(/_/g, ' ')}. Phase 1 takes no action automatically.`,
  };
}

export function buildSemiconductorEngine(args: {
  analysis: PortfolioAnalysis;
  quotes: Record<string, Quote>;
  priceHistory: Record<string, PriceBar[]>;
  config: StrategyConfig;
  coreSymbols?: string[];
}): SemiconductorEngine {
  const { analysis, quotes, priceHistory, config } = args;
  const coreSymbols = args.coreSymbols ?? ['TSM', 'SMH'];
  const benchmarkBars = priceHistory[config.trend.benchmarkSymbol] ?? [];

  const positionFor = (symbol: string) => analysis.positions.find((p) => p.symbol === symbol.toUpperCase());
  const barsFor = (symbol: string) => priceHistory[symbol.toUpperCase()] ?? [];
  const quoteFor = (symbol: string): Quote =>
    quotes[symbol.toUpperCase()] ?? {
      symbol: symbol.toUpperCase(),
      price: barsFor(symbol).at(-1)?.close ?? 0,
      previousClose: 0,
      dayChangePct: 0,
      asOf: analysis.asOf,
      dataQuality: 'stale',
    };

  const trendFor = (symbol: string) =>
    computeTrendSignal({
      symbol,
      bars: barsFor(symbol),
      quote: quoteFor(symbol),
      config: config.trend,
      benchmarkBars,
    });

  const cores = coreSymbols.map((symbol) => {
    const instrument = getInstrumentOrFallback(symbol);
    const position = positionFor(symbol);
    const trend = trendFor(symbol);
    return {
      symbol: symbol.toUpperCase(),
      name: instrument.name,
      role: 'Permanent Core',
      held: Boolean(position && position.shares > 0),
      shares: position?.shares ?? 0,
      price: quoteFor(symbol).price,
      marketValue: position?.marketValue ?? 0,
      unrealizedPL: position?.unrealizedPL ?? 0,
      unrealizedPLPct: position?.unrealizedPLPct ?? null,
      trend,
      dip: computeDipSignal({ symbol, bars: barsFor(symbol), quote: quoteFor(symbol), config, trend }),
    };
  });

  const leveragedPositions = analysis.positions.filter((p) => p.leverage > 1);
  const leveragedValue = leveragedPositions.reduce((acc, p) => acc + p.marketValue, 0);
  const leveragedPct = safeDiv(leveragedValue, analysis.totals.totalValue);
  const overLimit = leveragedPct > config.maxLeveragedSleevePct;

  const exposure: LeveragedExposure = {
    leveragedValue,
    leveragedPct,
    maxPct: config.maxLeveragedSleevePct,
    headroom: Math.max(0, analysis.totals.totalValue * config.maxLeveragedSleevePct - leveragedValue),
    overLimit,
    weightedLeverage: leveragedValue > 0
      ? leveragedPositions.reduce((acc, p) => acc + p.leverage * p.marketValue, 0) / leveragedValue
      : 0,
    positions: leveragedPositions.map((p) => {
      const trend = trendFor(p.symbol);
      const underlyingVol = trend.volatilityAnnualised != null ? trend.volatilityAnnualised / p.leverage : null;
      return {
        symbol: p.symbol,
        leverage: p.leverage,
        marketValue: p.marketValue,
        pctOfPortfolio: p.weight,
        unrealizedPL: p.unrealizedPL,
        unrealizedPLPct: p.unrealizedPLPct,
        drawdown: positionDrawdown(barsFor(p.symbol)),
        trendStatus: trend.status,
        estimatedVolatilityDrag: estimateVolatilityDrag(p.leverage, underlyingVol),
      };
    }),
  };

  const tactical = config.harvestRules.map((rule) => {
    const instrument = getInstrumentOrFallback(rule.symbol);
    const position = positionFor(rule.symbol);
    const trend = trendFor(rule.symbol);
    const bars = barsFor(rule.symbol);
    const drawdown = positionDrawdown(bars);
    const underlyingVol = trend.volatilityAnnualised != null ? trend.volatilityAnnualised / instrument.leverage : null;
    return {
      symbol: rule.symbol,
      name: instrument.name,
      leverage: instrument.leverage,
      destinationSymbol: rule.destinationSymbol,
      held: Boolean(position && position.shares > 0),
      shares: position?.shares ?? 0,
      price: quoteFor(rule.symbol).price,
      marketValue: position?.marketValue ?? 0,
      tacticalCostBasis: position?.tacticalCostBasisTotal ?? 0,
      unrealizedPL: position?.unrealizedPL ?? 0,
      unrealizedPLPct: position?.unrealizedPLPct ?? null,
      trend,
      dip: computeDipSignal({ symbol: rule.symbol, bars, quote: quoteFor(rule.symbol), config, trend }),
      harvest: computeHarvestSignal({ rule, position, quote: quotes[rule.symbol], trend, bars }),
      drawdown,
      estimatedVolatilityDrag: estimateVolatilityDrag(instrument.leverage, underlyingVol),
      riskReduction: computeRiskReduction({
        symbol: rule.symbol,
        trend,
        drawdown,
        config,
        overLeverageLimit: overLimit,
      }),
    };
  });

  return {
    cores,
    tactical,
    exposure,
    flywheel: tactical.map((t) => ({
      from: t.symbol,
      to: t.destinationSymbol,
      armed: t.harvest.armed,
      proceeds: t.harvest.harvestProceeds,
    })),
  };
}
