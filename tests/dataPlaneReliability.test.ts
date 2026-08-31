import { describe, expect, it } from 'vitest';
import {
  REPRESENTATIVE_100_CYCLE_PLAN,
  runReliabilityFailureCycles,
} from '../src/data/reliability.js';

describe('data-plane repeated failure-cycle reliability', () => {
  it('meets the >=95% strict usable-state target across the representative 100-cycle injection plan', () => {
    const result = runReliabilityFailureCycles(REPRESENTATIVE_100_CYCLE_PLAN, 95);

    expect(result.cycles).toBe(100);
    expect(result.systemUsablePct).toBe(97);
    expect(result.systemUsableCycles).toBe(97);
    expect(result.systemUnusableCycles).toBe(3);
    expect(result.meetsTarget).toBe(true);

    const options = result.lanes.find((lane) => lane.requirement === 'options_positioning');
    expect(options?.unusableCycles).toBe(3);
    expect(options?.expiredCycles).toBe(3);

    for (const lane of result.lanes.filter((lane) => lane.requirement !== 'options_positioning')) {
      expect(lane.unusableCycles).toBe(0);
    }
  });

  it('retains the last verified observation during failures instead of pretending a failed refresh is new evidence', () => {
    const result = runReliabilityFailureCycles({
      cycles: 8,
      cycleMs: 15 * 60_000,
      startAt: '2026-08-31T00:00:00.000Z',
      lanes: [{
        requirement: 'current_quotes',
        refreshEveryCycles: 1,
        failCycles: [2, 3, 4, 5],
      }],
    });

    const quotes = result.lanes[0];
    expect(quotes.injectedFailures).toBe(4);
    expect(quotes.retainedCycles).toBe(4);
    expect(quotes.unusableCycles).toBe(0);
    expect(result.systemUsablePct).toBe(100);
  });

  it('fails visibly when an outage exceeds the explicit stale-usable window', () => {
    const result = runReliabilityFailureCycles({
      cycles: 100,
      cycleMs: 15 * 60_000,
      startAt: '2026-08-31T00:00:00.000Z',
      lanes: [{
        requirement: 'options_positioning',
        refreshEveryCycles: 4,
        failCycles: [24, 28, 32, 36, 40, 44, 48, 52],
      }],
    }, 95);

    expect(result.meetsTarget).toBe(false);
    expect(result.systemUsablePct).toBeLessThan(95);
    expect(result.lanes[0].expiredCycles).toBeGreaterThan(0);
    expect(result.firstUnusableCycles.length).toBeGreaterThan(0);
  });
});
