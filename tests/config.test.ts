import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  MILESTONES,
  STRATEGY_LEVELS,
  activeMilestone,
  mergeStrategyConfig,
  strategyLevelFor,
} from '../src/core/config.js';

/**
 * The strategy config is the only place policy lives. These tests pin the
 * behaviours the plan calls non-negotiable: the reserve and the 50/50 income
 * split are editable defaults, and a partial patch can never widen the
 * execution phase or clear the kill switch.
 */
describe('defaults', () => {
  it('reserves $10,000 of liquidity by default and keeps it configurable', () => {
    expect(DEFAULT_STRATEGY_CONFIG.liquidityReserve).toBe(10_000);
    const raised = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, { liquidityReserve: 25_000 });
    expect(raised.liquidityReserve).toBe(25_000);
    const cleared = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, { liquidityReserve: 0 });
    expect(cleared.liquidityReserve).toBe(0);
  });

  it('treats the 50/50 income split as an opening position, not a hard-coded rule', () => {
    expect(DEFAULT_STRATEGY_CONFIG.incomeAllocationTargets).toEqual({ NVDY: 0.5, YMAG: 0.5 });
    const retuned = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, {
      incomeAllocationTargets: { NVDY: 0.3, YMAG: 0.3, QQQI: 0.4 },
    });
    expect(retuned.incomeAllocationTargets).toEqual({ NVDY: 0.3, YMAG: 0.3, QQQI: 0.4 });
    // Replaced wholesale rather than merged, so a removed symbol really goes.
    expect(Object.keys(retuned.incomeAllocationTargets)).toHaveLength(3);
  });

  it('ships the milestone ladder the plan specifies', () => {
    expect(MILESTONES.map((m) => m.monthlyIncome)).toEqual([150, 500, 1000, 2500, 5000]);
    expect(activeMilestone(DEFAULT_STRATEGY_CONFIG).monthlyIncome).toBe(500);
  });

  it('starts in observer phase with the kill switch open', () => {
    expect(DEFAULT_STRATEGY_CONFIG.executionPhase).toBe(1);
    expect(DEFAULT_STRATEGY_CONFIG.killSwitch).toBe(false);
  });

  it('carries the harvest rules as configurable data', () => {
    const soxl = DEFAULT_STRATEGY_CONFIG.harvestRules.find((r) => r.symbol === 'SOXL')!;
    const tsmx = DEFAULT_STRATEGY_CONFIG.harvestRules.find((r) => r.symbol === 'TSMX')!;
    expect(soxl).toMatchObject({ triggerGainPct: 0.25, harvestPortionPct: 0.25, destinationSymbol: 'SMH' });
    expect(tsmx).toMatchObject({ triggerGainPct: 0.2, harvestPortionPct: 0.25, destinationSymbol: 'TSM' });
  });

  it('caps the leveraged sleeve and offers the four dip levels', () => {
    expect(DEFAULT_STRATEGY_CONFIG.maxLeveragedSleevePct).toBe(0.1);
    expect(DEFAULT_STRATEGY_CONFIG.dipLevels).toEqual([0.05, 0.1, 0.15, 0.2]);
  });
});

describe('mergeStrategyConfig', () => {
  it('returns the base untouched for an empty patch', () => {
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, null)).toBe(DEFAULT_STRATEGY_CONFIG);
    expect(mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, {})).toEqual(DEFAULT_STRATEGY_CONFIG);
  });

  it('never widens the execution phase when the patch omits it', () => {
    const patched = mergeStrategyConfig({ ...DEFAULT_STRATEGY_CONFIG, executionPhase: 2 }, { dripRate: 0.5 });
    expect(patched.executionPhase).toBe(2);
    const explicit = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, { executionPhase: 3 });
    expect(explicit.executionPhase).toBe(3);
  });

  it('never clears an engaged kill switch by omission', () => {
    const engaged = { ...DEFAULT_STRATEGY_CONFIG, killSwitch: true };
    expect(mergeStrategyConfig(engaged, { dripRate: 0 }).killSwitch).toBe(true);
    expect(mergeStrategyConfig(engaged, { killSwitch: false }).killSwitch).toBe(false);
  });

  it('keeps list defaults when a patch supplies an empty list', () => {
    const patched = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, {
      milestones: [],
      harvestRules: [],
      dipLevels: [],
    });
    expect(patched.milestones).toEqual(MILESTONES);
    expect(patched.harvestRules).toEqual(DEFAULT_STRATEGY_CONFIG.harvestRules);
    expect(patched.dipLevels).toEqual(DEFAULT_STRATEGY_CONFIG.dipLevels);
  });

  it('merges trend and sleeve ceilings one level deep', () => {
    const patched = mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, {
      trend: { drawdownBreakPct: 0.3 } as never,
      sleeveCeilings: { tactical_leveraged: 0.05 },
    });
    expect(patched.trend.drawdownBreakPct).toBe(0.3);
    expect(patched.trend.longMaDays).toBe(200);
    expect(patched.sleeveCeilings.tactical_leveraged).toBe(0.05);
    expect(patched.sleeveCeilings.shipping_cyclical).toBe(0.15);
  });
});

describe('activeMilestone', () => {
  it('falls back to the first milestone when the active id is unknown', () => {
    const config = { ...DEFAULT_STRATEGY_CONFIG, activeMilestoneId: 'ZZZ' };
    expect(activeMilestone(config).id).toBe('A');
  });
});

describe('strategyLevelFor', () => {
  it('maps income to the four strategy levels at their floors', () => {
    expect(strategyLevelFor(0).level).toBe(0);
    expect(strategyLevelFor(149.99).level).toBe(0);
    expect(strategyLevelFor(150).level).toBe(1);
    expect(strategyLevelFor(499).level).toBe(1);
    expect(strategyLevelFor(500).level).toBe(2);
    expect(strategyLevelFor(999).level).toBe(2);
    expect(strategyLevelFor(1000).level).toBe(3);
    expect(strategyLevelFor(100_000).level).toBe(3);
  });

  it('bifurcates at the $500/mo level, as the plan requires', () => {
    expect(strategyLevelFor(500).name).toBe('Bifurcate');
    expect(STRATEGY_LEVELS[3].incomeCeiling).toBeNull();
  });

  it('never returns undefined for a negative reading', () => {
    expect(strategyLevelFor(-10).level).toBe(0);
  });
});
