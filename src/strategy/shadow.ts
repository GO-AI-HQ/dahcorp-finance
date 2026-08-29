import type { StrategyConfig } from '../core/config.js';
import type { SemiconductorEngine } from '../core/semiconductor.js';
import type { DipSignal, TrendSignal, TrendStatus } from '../core/signals.js';

export type ShadowAction = 'buy' | 'hold' | 'harvest' | 'reduce' | 'exit' | 'reserve';

export interface StrategySignalView {
  symbol: string;
  held: boolean;
  price: number;
  dayChangePct: number;
  trend: TrendSignal;
  dip: DipSignal;
}

export interface ShadowDecision {
  marketDate: string;
  fingerprint: string;
  strategy: 'income_entry' | 'semi_core' | 'semi_tactical' | 'cash_queue';
  symbol: string;
  action: ShadowAction;
  accountExternalId: string | null;
  price: number;
  /** 0-100 evidence score. This is not a probability forecast. */
  score: number;
  suggestedNotional: number;
  rationale: string;
  signals: Record<string, unknown>;
  riskVerdict: Record<string, unknown> | null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function trendBase(status: TrendStatus): number {
  switch (status) {
    case 'TREND_CONFIRMED': return 62;
    case 'TREND_WEAKENING': return 44;
    case 'TREND_LOST': return 12;
    default: return 28;
  }
}

/**
 * Transparent entry score. It intentionally combines only deterministic fields
 * already visible in the UI; the number is an evidence ranking, not a promise
 * of future return and not a model confidence percentage.
 */
export function entryEvidenceScore(signal: StrategySignalView): number {
  let score = trendBase(signal.trend.status);
  const dip = signal.dip.levelReached ?? 0;
  score += Math.min(24, dip * 160);
  if (signal.dip.actionable) score += 8;
  if (signal.trend.rsi != null) {
    if (signal.trend.rsi >= 45 && signal.trend.rsi <= 68) score += 6;
    if (signal.trend.rsi > 75) score -= 12;
    if (signal.trend.rsi < 40) score -= 12;
  }
  if (signal.trend.relativeStrength60d != null && signal.trend.relativeStrength60d > 0) score += 5;
  if (signal.dayChangePct <= -0.05) score += 4;
  return Math.round(clamp(score));
}

function genericDecision(args: {
  asOf: string;
  signal: StrategySignalView;
  accountId: string;
  strategy: 'income_entry' | 'semi_core';
}): ShadowDecision {
  const { asOf, signal, accountId, strategy } = args;
  const score = entryEvidenceScore(signal);
  const buy = signal.dip.actionable && signal.trend.status !== 'TREND_LOST' && score >= 60;
  const rationale = buy
    ? `${signal.symbol} reached a configured dip level while the deterministic trend framework remains intact enough for accumulation. Cash may be considered, subject to queue sizing and risk limits.`
    : `${signal.symbol} does not currently clear the deterministic entry bar. Cash remains in queue rather than forcing a purchase.`;
  return {
    marketDate: asOf,
    fingerprint: `${asOf}:${strategy}:${signal.symbol}`,
    strategy,
    symbol: signal.symbol,
    action: buy ? 'buy' : 'hold',
    accountExternalId: accountId,
    price: signal.price,
    score,
    suggestedNotional: 0,
    rationale,
    signals: {
      trendStatus: signal.trend.status,
      trendSummary: signal.trend.summary,
      dipActionable: signal.dip.actionable,
      dipLevelReached: signal.dip.levelReached,
      declineFromReference: signal.dip.declineFromReference,
      rsi: signal.trend.rsi,
      relativeStrength60d: signal.trend.relativeStrength60d,
      dayChangePct: signal.dayChangePct,
    },
    riskVerdict: null,
  };
}

function tacticalDecision(args: {
  asOf: string;
  tactical: SemiconductorEngine['tactical'][number];
  accountId: string;
  configuredWatermark: number;
  waterfall: StrategyConfig['profitWaterfallOrder'];
}): ShadowDecision {
  const { asOf, tactical, accountId } = args;
  const syntheticSignal: StrategySignalView = {
    symbol: tactical.symbol,
    held: tactical.held,
    price: tactical.price,
    dayChangePct: 0,
    trend: tactical.trend,
    dip: tactical.dip,
  };
  let score = entryEvidenceScore(syntheticSignal);
  let action: ShadowAction = 'hold';
  let rationale = `${tactical.symbol} is being observed; no tactical action clears the deterministic policy today.`;

  if (tactical.harvest.armedLive) {
    action = 'harvest';
    score = 95;
    rationale = `${tactical.symbol} cleared its verified profit-harvest trigger. Shadow Mode would skim eligible gains toward ${tactical.harvest.destinationSymbol} while treating the tactical principal watermark as capital to preserve, not a guaranteed floor.`;
  } else if (tactical.riskReduction.triggered) {
    action = tactical.riskReduction.recommendedAction === 'exit' ? 'exit' : 'reduce';
    score = 90;
    rationale = `${tactical.symbol} triggered deterministic risk reduction: ${tactical.riskReduction.reasons.join(' ')}`;
  } else if (tactical.dip.actionable && tactical.trend.status === 'TREND_CONFIRMED' && score >= 65) {
    action = 'buy';
    rationale = `${tactical.symbol} has both a qualified dip and confirmed trend. Shadow Mode would consider a small tactical add, bounded by the leveraged-sleeve ceiling and Cash Queue.`;
  }

  const principalWatermark = args.configuredWatermark > 0 ? args.configuredWatermark : tactical.tacticalCostBasis;
  return {
    marketDate: asOf,
    fingerprint: `${asOf}:semi_tactical:${tactical.symbol}`,
    strategy: 'semi_tactical',
    symbol: tactical.symbol,
    action,
    accountExternalId: accountId,
    price: tactical.price,
    score,
    suggestedNotional: action === 'harvest' ? tactical.harvest.harvestProceeds : 0,
    rationale,
    signals: {
      trendStatus: tactical.trend.status,
      dipActionable: tactical.dip.actionable,
      dipLevelReached: tactical.dip.levelReached,
      drawdown: tactical.drawdown,
      riskReduction: tactical.riskReduction,
      harvestArmed: tactical.harvest.armedLive,
      gainPct: tactical.harvest.gainPct,
      harvestProceeds: tactical.harvest.harvestProceeds,
      destinationSymbol: tactical.harvest.destinationSymbol,
      principalWatermark,
      profitWaterfallOrder: args.waterfall,
    },
    riskVerdict: {
      leveragedSleevePct: tactical.marketValue > 0 ? undefined : 0,
      note: 'No live order is produced by Shadow Mode.',
    },
  };
}

/**
 * Build one daily evidence set for the Agentic strategy. The function is pure:
 * no broker calls, model calls or database writes occur here.
 */
export function buildAgenticShadowDecisions(args: {
  asOf: string;
  config: StrategyConfig;
  signals: StrategySignalView[];
  semis: SemiconductorEngine;
  agenticAccountId: string;
  cash: number;
}): ShadowDecision[] {
  const allow = new Set(args.config.agenticGrowthAllowlist.map((symbol) => symbol.toUpperCase()));
  const bySymbol = new Map(args.signals.map((signal) => [signal.symbol.toUpperCase(), signal]));
  const decisions: ShadowDecision[] = [];

  const nvdy = bySymbol.get('NVDY');
  if (allow.has('NVDY') && nvdy) {
    decisions.push(genericDecision({ asOf: args.asOf, signal: nvdy, accountId: args.agenticAccountId, strategy: 'income_entry' }));
  }

  for (const symbol of ['SEMI', 'SMH', 'AMD']) {
    const signal = bySymbol.get(symbol);
    if (allow.has(symbol) && signal) {
      decisions.push(genericDecision({ asOf: args.asOf, signal, accountId: args.agenticAccountId, strategy: 'semi_core' }));
    }
  }

  for (const tactical of args.semis.tactical) {
    if (!allow.has(tactical.symbol)) continue;
    decisions.push(tacticalDecision({
      asOf: args.asOf,
      tactical,
      accountId: args.agenticAccountId,
      configuredWatermark: args.config.tacticalPrincipalWatermarks[tactical.symbol] ?? 0,
      waterfall: args.config.profitWaterfallOrder,
    }));
  }

  const queueCash = Math.max(0, args.cash - args.config.brokerCashFloor);
  const buys = decisions.filter((decision) => decision.action === 'buy').sort((a, b) => b.score - a.score);
  if (args.config.cashQueue.enabled && buys.length) {
    let remaining = queueCash;
    for (const decision of buys) {
      if (remaining <= 0) break;
      const cap = queueCash * clamp(args.config.cashQueue.maxDeployPctPerSignal, 0, 1);
      const suggested = Math.min(remaining, cap, args.config.maxOrderNotional);
      decision.suggestedNotional = Math.max(0, suggested);
      remaining -= suggested;
      decision.riskVerdict = {
        cashQueueBefore: queueCash,
        suggestedNotional: decision.suggestedNotional,
        maxOrderNotional: args.config.maxOrderNotional,
        brokerCashFloor: args.config.brokerCashFloor,
        shadowOnly: true,
      };
    }
  }

  if (args.config.cashQueue.enabled && !buys.length && queueCash > 0) {
    decisions.push({
      marketDate: args.asOf,
      fingerprint: `${args.asOf}:cash_queue:CASH`,
      strategy: 'cash_queue',
      symbol: 'CASH',
      action: 'reserve',
      accountExternalId: args.agenticAccountId,
      price: 1,
      score: 100,
      suggestedNotional: 0,
      rationale: `$${queueCash.toFixed(2)} remains in the Agentic Cash Queue because no approved entry signal currently requires deployment. Funding the account never forces a trade.`,
      signals: {
        queueCash,
        brokerCashFloor: args.config.brokerCashFloor,
        requireQualifiedSignal: args.config.cashQueue.requireQualifiedSignal,
      },
      riskVerdict: { shadowOnly: true },
    });
  }

  return decisions;
}
