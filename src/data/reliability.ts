import {
  classifySnapshotFreshness,
  routeFor,
  type DataPlaneRequirement,
  type SnapshotFreshness,
} from './dataPlane.js';

export interface ReliabilityLanePlan {
  requirement: DataPlaneRequirement;
  /** Number of base cycles between scheduled refresh attempts. */
  refreshEveryCycles: number;
  /** Scheduled cycle numbers whose provider refresh is deliberately failed. */
  failCycles: readonly number[];
}

export interface ReliabilityTestPlan {
  cycles: number;
  cycleMs: number;
  startAt: string;
  lanes: readonly ReliabilityLanePlan[];
}

export interface ReliabilityLaneResult {
  requirement: DataPlaneRequirement;
  usableCycles: number;
  unusableCycles: number;
  usablePct: number;
  refreshAttempts: number;
  injectedFailures: number;
  retainedCycles: number;
  freshCycles: number;
  staleUsableCycles: number;
  expiredCycles: number;
}

export interface ReliabilityTestResult {
  cycles: number;
  systemUsableCycles: number;
  systemUnusableCycles: number;
  systemUsablePct: number;
  targetPct: number;
  meetsTarget: boolean;
  lanes: ReliabilityLaneResult[];
  firstUnusableCycles: Array<{ cycle: number; requirements: DataPlaneRequirement[] }>;
  note: string;
}

interface MutableLaneState {
  plan: ReliabilityLanePlan;
  lastVerifiedAt: string;
  retainingAfterFailure: boolean;
  refreshAttempts: number;
  injectedFailures: number;
  retainedCycles: number;
  freshCycles: number;
  staleUsableCycles: number;
  expiredCycles: number;
  usableCycles: number;
  unusableCycles: number;
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 10_000) / 100 : 0;
}

/**
 * Deterministic failure-injection harness for the snapshot retention policy.
 *
 * Cycle zero is a verified baseline for every lane. Later scheduled failures do
 * not manufacture substitute evidence or advance observedAt; the last verified
 * observation remains in force until its explicit stale-usable window expires.
 * A system cycle is counted usable only when every included lane is usable,
 * making the aggregate target intentionally strict.
 */
export function runReliabilityFailureCycles(
  plan: ReliabilityTestPlan,
  targetPct = 95,
): ReliabilityTestResult {
  if (!Number.isInteger(plan.cycles) || plan.cycles <= 0) throw new Error('Reliability cycles must be a positive integer.');
  if (!Number.isFinite(plan.cycleMs) || plan.cycleMs <= 0) throw new Error('Reliability cycleMs must be positive.');
  const startMs = Date.parse(plan.startAt);
  if (!Number.isFinite(startMs)) throw new Error('Reliability startAt must be a valid timestamp.');

  const states: MutableLaneState[] = plan.lanes.map((lane) => {
    if (!Number.isInteger(lane.refreshEveryCycles) || lane.refreshEveryCycles <= 0) {
      throw new Error(`Invalid refresh cadence for ${lane.requirement}.`);
    }
    return {
      plan: lane,
      lastVerifiedAt: new Date(startMs).toISOString(),
      retainingAfterFailure: false,
      refreshAttempts: 0,
      injectedFailures: 0,
      retainedCycles: 0,
      freshCycles: 0,
      staleUsableCycles: 0,
      expiredCycles: 0,
      usableCycles: 0,
      unusableCycles: 0,
    };
  });

  let systemUsableCycles = 0;
  const firstUnusableCycles: Array<{ cycle: number; requirements: DataPlaneRequirement[] }> = [];

  for (let cycle = 1; cycle <= plan.cycles; cycle += 1) {
    const now = new Date(startMs + cycle * plan.cycleMs);
    const unavailable: DataPlaneRequirement[] = [];

    for (const state of states) {
      const route = routeFor(state.plan.requirement);
      const scheduled = cycle % state.plan.refreshEveryCycles === 0;
      if (scheduled) {
        state.refreshAttempts += 1;
        const failed = state.plan.failCycles.includes(cycle);
        if (failed) {
          state.injectedFailures += 1;
          state.retainingAfterFailure = route.allowLastKnownGood;
        } else {
          state.lastVerifiedAt = now.toISOString();
          state.retainingAfterFailure = false;
        }
      }

      const freshness: SnapshotFreshness = classifySnapshotFreshness(state.lastVerifiedAt, route.freshness, now);
      if (freshness === 'fresh') state.freshCycles += 1;
      if (freshness === 'stale_usable') state.staleUsableCycles += 1;
      if (freshness === 'expired' || freshness === 'invalid') state.expiredCycles += 1;

      const freshnessUsable = freshness === 'fresh' || freshness === 'stale_usable';
      const usable = freshnessUsable && (!state.retainingAfterFailure || route.allowLastKnownGood);
      if (usable) {
        state.usableCycles += 1;
        if (state.retainingAfterFailure) state.retainedCycles += 1;
      } else {
        state.unusableCycles += 1;
        unavailable.push(state.plan.requirement);
      }
    }

    if (!unavailable.length) {
      systemUsableCycles += 1;
    } else if (firstUnusableCycles.length < 20) {
      firstUnusableCycles.push({ cycle, requirements: unavailable });
    }
  }

  const systemUsablePct = pct(systemUsableCycles, plan.cycles);
  return {
    cycles: plan.cycles,
    systemUsableCycles,
    systemUnusableCycles: plan.cycles - systemUsableCycles,
    systemUsablePct,
    targetPct,
    meetsTarget: systemUsablePct >= targetPct,
    lanes: states.map((state) => ({
      requirement: state.plan.requirement,
      usableCycles: state.usableCycles,
      unusableCycles: state.unusableCycles,
      usablePct: pct(state.usableCycles, plan.cycles),
      refreshAttempts: state.refreshAttempts,
      injectedFailures: state.injectedFailures,
      retainedCycles: state.retainedCycles,
      freshCycles: state.freshCycles,
      staleUsableCycles: state.staleUsableCycles,
      expiredCycles: state.expiredCycles,
    })),
    firstUnusableCycles,
    note: 'Controlled failure injection validates snapshot/last-known-good behavior only. It is not a production-provider SLA measurement; live refresh outcomes must be observed separately before claiming production >=95% reliability.',
  };
}

/**
 * 100 x 15-minute cycles (25 hours) spanning the key tiered refresh families.
 * The injected outages include multi-hour quote and intelligence failures, two
 * failed history refreshes, one failed daily distribution refresh and an
 * options outage that deliberately exceeds its six-hour stale window briefly.
 */
export const REPRESENTATIVE_100_CYCLE_PLAN: ReliabilityTestPlan = {
  cycles: 100,
  cycleMs: 15 * 60_000,
  startAt: '2026-08-31T00:00:00.000Z',
  lanes: [
    { requirement: 'broker_accounts', refreshEveryCycles: 4, failCycles: [20, 24, 28] },
    { requirement: 'current_quotes', refreshEveryCycles: 1, failCycles: Array.from({ length: 16 }, (_, index) => 30 + index) },
    { requirement: 'price_history', refreshEveryCycles: 24, failCycles: [24, 48] },
    { requirement: 'distribution_history', refreshEveryCycles: 96, failCycles: [96] },
    { requirement: 'earnings_calendar', refreshEveryCycles: 4, failCycles: [40, 44, 48, 52, 56, 60] },
    { requirement: 'options_positioning', refreshEveryCycles: 4, failCycles: [24, 28, 32, 36, 40, 44] },
  ],
};
