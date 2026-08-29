import type { CalculationScope, WholePortfolioRules } from './scope.js';
import { DEFAULT_WHOLE_PORTFOLIO_RULES } from './scope.js';
import type { Sleeve } from './types.js';

/** Which trailing window to model distributions from. User-selectable. */
export type DistributionBasis = 'latest' | 'avg4w' | 'avg13w' | 'avg26w' | 'avg52w';

export const DISTRIBUTION_BASIS_LABELS: Record<DistributionBasis, string> = {
  latest: 'Latest declared',
  avg4w: '4-week average',
  avg13w: '13-week average',
  avg26w: '26-week average',
  avg52w: '52-week average',
};

/** Reference anchor for dip-level measurement. */
export type DipReference = 'recent_high_60d' | 'high_52w' | 'sma50' | 'sma200' | 'fair_value';

/**
 * Agentic execution lifecycle. Shadow observes only. Confirm permits broker
 * previews that still require explicit investor confirmation. Bounded is a
 * future policy state and does not itself grant an adapter permission to trade.
 */
export type AgenticExecutionMode = 'shadow' | 'confirm' | 'bounded';

export type ProfitWaterfallDestination =
  | 'restore_tactical_principal'
  | 'core_growth'
  | 'income_engine'
  | 'cash_reserve';

export interface CashQueueConfig {
  /** When true, new brokerage cash may remain idle indefinitely. */
  enabled: boolean;
  /** Cash is deployed only after a deterministic strategy signal qualifies. */
  requireQualifiedSignal: boolean;
  /** Additional cap on a single qualified deployment, as a fraction of queue cash. */
  maxDeployPctPerSignal: number;
}

export interface ShadowReadinessConfig {
  /** Evidence target, not a model-training claim. */
  minimumObservations: number;
  /** Minimum distinct market dates represented in the shadow ledger. */
  minimumTradingDays: number;
}

export interface IncomeMilestone {
  id: string;
  label: string;
  monthlyIncome: number;
}

export interface HarvestRule {
  /** Tactical instrument being harvested. */
  symbol: string;
  /** Gain from tactical cost basis that arms the harvest, as a fraction. */
  triggerGainPct: number;
  /** Portion of the position to harvest when armed, as a fraction. */
  harvestPortionPct: number;
  /** Permanent holding the proceeds are directed into. */
  destinationSymbol: string;
  enabled: boolean;
}

export interface TrendConfig {
  shortMaDays: number;
  mediumMaDays: number;
  longMaDays: number;
  rsiPeriod: number;
  /** RSI below this is treated as momentum failure, not a dip to buy. */
  rsiWeakBelow: number;
  /** RSI above this flags an extended move. */
  rsiExtendedAbove: number;
  /** Drawdown from recent high that downgrades trend, as a fraction. */
  drawdownWarnPct: number;
  /** Drawdown from recent high that breaks trend, as a fraction. */
  drawdownBreakPct: number;
  /** Benchmark used for relative-strength confirmation. */
  benchmarkSymbol: string;
  /** Require volume expansion to confirm a trend upgrade. */
  requireVolumeConfirmation: boolean;
}

/**
 * The complete deterministic policy. Everything an LLM is allowed to influence
 * lives here as data — a model may *propose* changes, but only a human writing
 * settings can change them, and the risk engine only ever reads this object.
 */
export interface StrategyConfig {
  /**
   * Which slice of capital every headline calculation is expressed in.
   * Defaults to the taxable income engine so retirement and education
   * holdings never dilute the modeled distribution rate.
   */
  calculationScope: CalculationScope;
  /**
   * Household / external emergency reserve target. This money lives outside
   * the brokerages (bank, savings, cash) and is *not* expected to sit idle in
   * Robinhood or Schwab. Being under target raises a warning; it never
   * converts planned contributions into zero investable cash.
   */
  externalLiquidityTarget: number;
  /** Household / external liquidity currently held, as entered by the investor. */
  externalLiquidityCurrent: number;
  /**
   * Brokerage cash that must stay uninvested for settlement and fees. This is
   * a working buffer, not the emergency reserve, so it is normally small.
   */
  brokerCashFloor: number;
  /** Risk rules deliberately measured across every account, not just taxable. */
  wholePortfolioRules: WholePortfolioRules;
  /** Income milestones, ascending. */
  milestones: IncomeMilestone[];
  /** The milestone currently being driven toward. */
  activeMilestoneId: string;
  /** Target date for the active milestone, ISO. Empty means "no date set". */
  targetDate: string;
  /** Trailing window used to model distribution rates. */
  distributionBasis: DistributionBasis;
  /** Conservative haircut applied to modeled distribution rates (0-1). */
  conservativeHaircut: number;
  /** Portion of received distributions reinvested (0-1). */
  dripRate: number;
  /** Planned recurring external contribution per month. */
  monthlyContribution: number;
  /** Income-engine allocation weights by symbol; must sum to ~1. NOT permanent. */
  incomeAllocationTargets: Record<string, number>;
  /** At the bifurcation milestone, share of distributions kept in the engine. */
  bifurcationReinvestShare: number;
  /** Maximum share of portfolio value allowed in the leveraged sleeve. */
  maxLeveragedSleevePct: number;
  /** Maximum share of portfolio value allowed in any single position. */
  maxSinglePositionPct: number;
  /** Maximum share of portfolio value allowed in any single underlying exposure. */
  maxSingleExposurePct: number;
  /** Maximum dollar size of any single proposed order. */
  maxOrderNotional: number;
  /** Sleeve ceilings, as fractions of portfolio value. Absent = uncapped. */
  sleeveCeilings: Partial<Record<Sleeve, number>>;
  /** Tactical harvest rules. */
  harvestRules: HarvestRule[];
  /** Dip levels for long-term accumulation, as positive fractions. */
  dipLevels: number[];
  dipReference: DipReference;
  trend: TrendConfig;

  /** Current Agentic lifecycle state. Shadow is the safe production default. */
  agenticExecutionMode: AgenticExecutionMode;
  /** Securities the Robinhood Agentic growth engine is allowed to reason about. */
  agenticGrowthAllowlist: string[];
  /** Cash arriving at the Agentic account is a queue, never an automatic buy. */
  cashQueue: CashQueueConfig;
  /** Evidence thresholds used by the readiness UI. */
  shadowReadiness: ShadowReadinessConfig;
  /**
   * Tactical principal reference dollars by symbol. Zero means the engine uses
   * verified tactical cost basis as the current watermark until the investor
   * explicitly sets a fixed reference.
   */
  tacticalPrincipalWatermarks: Record<string, number>;
  /** Priority order for profits above the tactical principal watermark. */
  profitWaterfallOrder: ProfitWaterfallDestination[];

  /** Execution phase. Phase 1 = observer. Live trading is never enabled here. */
  executionPhase: 1 | 2 | 3 | 4 | 5;
  /** Global kill switch — when true no order may be previewed or placed. */
  killSwitch: boolean;
}

export const MILESTONES: IncomeMilestone[] = [
  { id: 'A', label: 'Milestone A', monthlyIncome: 150 },
  { id: 'B', label: 'Milestone B', monthlyIncome: 500 },
  { id: 'C', label: 'Milestone C', monthlyIncome: 1000 },
  { id: 'D', label: 'Milestone D', monthlyIncome: 2500 },
  { id: 'E', label: 'Milestone E', monthlyIncome: 5000 },
];

/**
 * Defaults, not doctrine. Every value here is editable in Settings and
 * persisted per-user. The 50/50 income split in particular is an opening
 * position, not a permanent rule — the opportunity ranker continuously tests
 * whether a different mix better serves the monthly-income objective.
 */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  calculationScope: 'TAXABLE_INCOME_ENGINE',
  externalLiquidityTarget: 10_000,
  externalLiquidityCurrent: 0,
  brokerCashFloor: 0,
  wholePortfolioRules: DEFAULT_WHOLE_PORTFOLIO_RULES,
  milestones: MILESTONES,
  activeMilestoneId: 'B',
  targetDate: '',
  distributionBasis: 'avg13w',
  conservativeHaircut: 0.25,
  dripRate: 1,
  monthlyContribution: 300,
  incomeAllocationTargets: { NVDY: 0.5, YMAG: 0.5 },
  bifurcationReinvestShare: 0.5,
  maxLeveragedSleevePct: 0.1,
  maxSinglePositionPct: 0.35,
  maxSingleExposurePct: 0.45,
  maxOrderNotional: 2_500,
  sleeveCeilings: { tactical_leveraged: 0.1, shipping_cyclical: 0.15 },
  harvestRules: [
    { symbol: 'SOXL', triggerGainPct: 0.25, harvestPortionPct: 0.25, destinationSymbol: 'SMH', enabled: true },
    { symbol: 'TSMX', triggerGainPct: 0.2, harvestPortionPct: 0.25, destinationSymbol: 'TSM', enabled: true },
  ],
  dipLevels: [0.05, 0.1, 0.15, 0.2],
  dipReference: 'high_52w',
  trend: {
    shortMaDays: 20,
    mediumMaDays: 50,
    longMaDays: 200,
    rsiPeriod: 14,
    rsiWeakBelow: 40,
    rsiExtendedAbove: 75,
    drawdownWarnPct: 0.12,
    drawdownBreakPct: 0.2,
    benchmarkSymbol: 'SMH',
    requireVolumeConfirmation: false,
  },
  agenticExecutionMode: 'shadow',
  agenticGrowthAllowlist: ['NVDY', 'SOXL', 'TSMX', 'SEMI', 'SMH', 'AMD'],
  cashQueue: {
    enabled: true,
    requireQualifiedSignal: true,
    maxDeployPctPerSignal: 1,
  },
  shadowReadiness: {
    minimumObservations: 30,
    minimumTradingDays: 20,
  },
  tacticalPrincipalWatermarks: { SOXL: 0, TSMX: 0 },
  profitWaterfallOrder: ['restore_tactical_principal', 'core_growth', 'income_engine', 'cash_reserve'],
  executionPhase: 1,
  killSwitch: false,
};

/**
 * A stored or submitted patch. Everything is optional, and nested risk / Agentic
 * objects may arrive one key at a time — a UI toggle changes one rule, not the set.
 */
export type StrategyConfigPatch = Partial<
  Omit<StrategyConfig, 'wholePortfolioRules' | 'cashQueue' | 'shadowReadiness'>
> & {
  wholePortfolioRules?: Partial<WholePortfolioRules>;
  cashQueue?: Partial<CashQueueConfig>;
  shadowReadiness?: Partial<ShadowReadinessConfig>;
};

export function mergeStrategyConfig(
  base: StrategyConfig,
  patch: StrategyConfigPatch | null | undefined,
): StrategyConfig {
  if (!patch) return base;
  // Pre-1.1 configs stored a single `liquidityReserve`, which conflated the
  // household emergency fund with brokerage settlement cash. Roll it forward
  // into the external target it was always meant to describe.
  const legacyReserve = (patch as { liquidityReserve?: unknown }).liquidityReserve;
  const migratedExternalTarget =
    patch.externalLiquidityTarget ??
    (typeof legacyReserve === 'number' && Number.isFinite(legacyReserve)
      ? Math.max(0, legacyReserve)
      : base.externalLiquidityTarget);
  return {
    ...base,
    ...patch,
    calculationScope: patch.calculationScope ?? base.calculationScope,
    externalLiquidityTarget: migratedExternalTarget,
    wholePortfolioRules: { ...base.wholePortfolioRules, ...(patch.wholePortfolioRules ?? {}) },
    milestones: patch.milestones?.length ? patch.milestones : base.milestones,
    incomeAllocationTargets: patch.incomeAllocationTargets ?? base.incomeAllocationTargets,
    sleeveCeilings: { ...base.sleeveCeilings, ...(patch.sleeveCeilings ?? {}) },
    harvestRules: patch.harvestRules?.length ? patch.harvestRules : base.harvestRules,
    dipLevels: patch.dipLevels?.length ? patch.dipLevels : base.dipLevels,
    trend: { ...base.trend, ...(patch.trend ?? {}) },
    agenticExecutionMode: patch.agenticExecutionMode ?? base.agenticExecutionMode,
    agenticGrowthAllowlist: patch.agenticGrowthAllowlist?.length ? patch.agenticGrowthAllowlist.map((s) => s.toUpperCase()) : base.agenticGrowthAllowlist,
    cashQueue: { ...base.cashQueue, ...(patch.cashQueue ?? {}) },
    shadowReadiness: { ...base.shadowReadiness, ...(patch.shadowReadiness ?? {}) },
    tacticalPrincipalWatermarks: {
      ...base.tacticalPrincipalWatermarks,
      ...(patch.tacticalPrincipalWatermarks ?? {}),
    },
    profitWaterfallOrder: patch.profitWaterfallOrder?.length ? patch.profitWaterfallOrder : base.profitWaterfallOrder,
    // Execution phase and the kill switch are deliberately never widened by a
    // partial patch that omits them.
    executionPhase: patch.executionPhase ?? base.executionPhase,
    killSwitch: patch.killSwitch ?? base.killSwitch,
  };
}

export function activeMilestone(config: StrategyConfig): IncomeMilestone {
  return config.milestones.find((m) => m.id === config.activeMilestoneId) ?? config.milestones[0];
}

/** Strategy level derived from sustainable monthly income, per the plan. */
export type StrategyLevel = 0 | 1 | 2 | 3;

export interface StrategyLevelInfo {
  level: StrategyLevel;
  name: string;
  goal: string;
  incomeFloor: number;
  incomeCeiling: number | null;
}

export const STRATEGY_LEVELS: StrategyLevelInfo[] = [
  { level: 0, name: 'Prove the Engine', goal: 'Reach ~$150/mo and validate that the strategy compounds economically, not just in cash received.', incomeFloor: 0, incomeCeiling: 150 },
  { level: 1, name: 'Build the Engine', goal: 'Reach ~$500/mo. Full reinvestment. The engine becomes large enough to finance other assets.', incomeFloor: 150, incomeCeiling: 500 },
  { level: 2, name: 'Bifurcate', goal: 'Split distributions between compounding the engine and buying long-term growth assets.', incomeFloor: 500, incomeCeiling: 1000 },
  { level: 3, name: 'Capital Production', goal: 'The portfolio finances growth, semiconductor core and future education capital.', incomeFloor: 1000, incomeCeiling: null },
];

export function strategyLevelFor(monthlyIncome: number): StrategyLevelInfo {
  for (let i = STRATEGY_LEVELS.length - 1; i >= 0; i--) {
    if (monthlyIncome >= STRATEGY_LEVELS[i].incomeFloor) return STRATEGY_LEVELS[i];
  }
  return STRATEGY_LEVELS[0];
}
