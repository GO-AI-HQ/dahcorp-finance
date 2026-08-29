import type { PriceBar, Quote } from './types.js';
import type { HarvestRule, StrategyConfig } from './config.js';
import { safeDiv } from './math.js';
import { computeDipSignal, computeTrendSignal, positionDrawdown, type DipSignal, type TrendSignal } from './signals.js';
import type { PortfolioAnalysis, PositionView } from './portfolio.js';
import { getInstrumentOrFallback } from './universe.js';
import type { VerificationStatus } from './scope.js';
import { decorateTriggerLabel, isVerified, riskScopeFor } from './scope.js';

/**
 * Semiconductor capital-recycling engine.
 *
 * SEMI / SMH / AMD are long-horizon core candidates. TSMX (~2x) and SOXL (3x)
 * are daily-reset tactical instruments whose eligible profits can be redirected
 * into the permanent core. The principal watermark is an accounting policy,
 * never a guarantee that leveraged principal cannot decline.
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
  /** Verified tactical basis reported by the brokerage. */
  tacticalCostBasis: number;
  /** Principal reference the recycling engine attempts to leave in place. */
  principalWatermark: number;
  tacticalCostBasisPerShare: number | null;
  /** Market value less the principal watermark. May be negative. */
  unrealizedPL: number;
  /** Positive dollars currently above the principal watermark. */
  eligibleProfit: number;
  gainPct: number | null;
  triggerGainPct: number;
  /** Price at which the harvest trigger arms. */
  triggerPrice: number | null;
  /** 0-1 progress from the principal watermark to the trigger. */
  progressToTrigger: number | null;
  /** Whether the arithmetic conditions of the rule are met. */
  armed: boolean;
  /**
   * Whether the rule may actually fire. A SIMULATED or UNVERIFIED position can
   * be `armed` for demonstration but is never `armedLive`, so it cannot reach
   * the risk engine, the agent digest or the headline risk banner.
   */
  armedLive: boolean;
  verification: VerificationStatus;
  /** Fraction of eligible profit skimmed when the rule is armed. */
  harvestPortionPct: number;
  /** Shares and dollars of eligible profit the rule would harvest right now. */
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
  /** Tactical-profit redirection legs, for the visualisation. */
  flywheel: {
    from: string;
    to: string;
    armed: boolean;
    armedLive: boolean;
    verification: VerificationStatus;
    proceeds: number;
  }[];
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
  /** Zero/absent means use verified tactical cost basis as the watermark. */
  principalWatermark?: number;
}): HarvestSignal {
  const { rule, position, quote, trend } = args;
  const price = quote?.price ?? position?.price ?? 0;
  const shares = position?.shares ?? 0;
  const marketValue = shares * price;
  const tacticalCostBasis = position?.tacticalCostBasisTotal ?? 0;
  const configuredWatermark = Number.isFinite(args.principalWatermark) && (args.principalWatermark ?? 0) > 0
    ? Math.max(0, args.principalWatermark ?? 0)
    : 0;
  const principalWatermark = configuredWatermark || tacticalCostBasis;
  const basisPerShare = shares > 0 && principalWatermark > 0 ? principalWatermark / shares : null;
  const unrealizedPL = marketValue - principalWatermark;
  const eligibleProfit = Math.max(0, unrealizedPL);
  const gainPct = principalWatermark > 0 ? unrealizedPL / principalWatermark : null;
  const triggerPrice = basisPerShare != null ? basisPerShare * (1 + rule.triggerGainPct) : null;
  const progressToTrigger =
    gainPct != null && rule.triggerGainPct > 0 ? Math.max(0, gainPct) / rule.triggerGainPct : null;

  const armed = Boolean(rule.enabled && shares > 0 && gainPct != null && gainPct >= rule.triggerGainPct && eligibleProfit > 0);
  const verification: VerificationStatus = position ? position.verification : 'CONFIRMED';
  const armedLive = armed && isVerified(verification);
  // Crucially, harvest only a portion of dollars ABOVE the principal watermark,
  // not a portion of the whole tactical position.
  const harvestProceeds = armed ? eligibleProfit * rule.harvestPortionPct : 0;
  const harvestShares = price > 0 ? harvestProceeds / price : 0;

  const unverifiedNote = armed && !armedLive
    ? ` Position is ${verification} — the rule is shown for demonstration and cannot fire until a brokerage adapter verifies ownership and cost basis.`
    : '';

  const ruleOutcome = !rule.enabled
    ? `Rule disabled for ${rule.symbol}.`
    : shares <= 0
      ? `No ${rule.symbol} position held — harvest rule inactive.`
      : gainPct == null
        ? `No tactical principal watermark is recorded for ${rule.symbol} — cannot evaluate the +${(rule.triggerGainPct * 100).toFixed(0)}% trigger.`
        : armed
          ? `${decorateTriggerLabel(verification, 'ARMED')}: ${rule.symbol} is +${(gainPct * 100).toFixed(1)}% above its $${principalWatermark.toFixed(2)} principal watermark (trigger +${(rule.triggerGainPct * 100).toFixed(0)}%). Rule skims ${(rule.harvestPortionPct * 100).toFixed(0)}% of eligible profit → ${rule.destinationSymbol}, leaving the principal watermark invested subject to normal market risk.${unverifiedNote}`
          : `NOT ARMED: ${rule.symbol} is ${(gainPct * 100).toFixed(1)}% vs its principal watermark; trigger is +${(rule.triggerGainPct * 100).toFixed(0)}%.`;

  return {
    symbol: rule.symbol,
    destinationSymbol: rule.destinationSymbol,
    enabled: rule.enabled,
    held: shares > 0,
    shares,
    price,
    marketValue,
    tacticalCostBasis,
    principalWatermark,
    tacticalCostBasisPerShare: basisPerShare,
    unrealizedPL,
    eligibleProfit,
    gainPct,
    triggerGainPct: rule.triggerGainPct,
    triggerPrice,
    progressToTrigger,
    armed,
    armedLive,
    verification,
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
        : `Deterministic rules recommend: ${action.replace(/_/g, ' ')}. Shadow Mode takes no action automatically.`,
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
  const coreSymbols = args.coreSymbols ?? ['SEMI', 'SMH', 'AMD'];
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
      role: 'Long-horizon Core',
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

  // The leveraged-sleeve ceiling is a whole-taxable-capital rule, so it is
  // measured in the risk scope rather than the display scope. Unverified
  // positions are excluded from the *limit* test — they cannot justify a live
  // reduce recommendation — but still appear in the position list below.
  const sleeveScope = riskScopeFor('sleeve', 'taxable', config.wholePortfolioRules);
  const sleeveView = analysis.scopes[sleeveScope];
  const leveragedPositions = analysis.positions.filter((p) => p.leverage > 1);
  const scopedLeveraged = sleeveView.positions.filter((p) => p.leverage > 1 && p.verified);
  const leveragedValue = scopedLeveraged.reduce((acc, p) => acc + p.marketValue, 0);
  const leveragedPct = safeDiv(leveragedValue, sleeveView.totalValue);
  const overLimit = leveragedPct > config.maxLeveragedSleevePct;

  const exposure: LeveragedExposure = {
    leveragedValue,
    leveragedPct,
    maxPct: config.maxLeveragedSleevePct,
    headroom: Math.max(0, sleeveView.totalValue * config.maxLeveragedSleevePct - leveragedValue),
    overLimit,
    weightedLeverage: leveragedValue > 0
      ? scopedLeveraged.reduce((acc, p) => acc + p.leverage * p.marketValue, 0) / leveragedValue
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
      harvest: computeHarvestSignal({
        rule,
        position,
        quote: quotes[rule.symbol],
        trend,
        bars,
        principalWatermark: config.tacticalPrincipalWatermarks[rule.symbol] ?? 0,
      }),
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
      armedLive: t.harvest.armedLive,
      verification: t.harvest.verification,
      proceeds: t.harvest.harvestProceeds,
    })),
  };
}
