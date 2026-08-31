import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ROUTES,
  classifySnapshotFreshness,
  createDataPlaneSnapshot,
  isSnapshotUsable,
  routeFor,
} from '../src/data/dataPlane.js';

describe('data-plane provider routing', () => {
  it('keeps broker state authoritative and does not invent a secondary broker source', () => {
    const route = routeFor('broker_accounts');
    expect(route.primary).toEqual(['schwab', 'robinhood']);
    expect(route.secondary).toEqual([]);
    expect(route.allowLastKnownGood).toBe(true);
  });

  it('routes income distributions FMP -> OpenBB while realized income remains broker-first', () => {
    expect(routeFor('distribution_history').primary).toEqual(['fmp']);
    expect(routeFor('distribution_history').secondary).toEqual(['openbb']);
    expect(routeFor('realized_income').primary).toEqual(['broker_realized']);
  });

  it('uses Finnhub as primary earnings/news/reference evidence and OpenBB as appropriate fallback', () => {
    expect(routeFor('earnings_calendar').primary).toEqual(['finnhub']);
    expect(routeFor('earnings_calendar').secondary).toContain('openbb');
    expect(routeFor('company_market_news').primary).toEqual(['finnhub']);
    expect(routeFor('security_reference').primary).toEqual(['finnhub']);
  });

  it('keeps V3 options on OpenBB and treats the eight research lanes as separate requirements', () => {
    expect(routeFor('options_positioning').primary).toEqual(['openbb']);
    expect(routeFor('short_interest_crowding').primary).toContain('finra');
    expect(routeFor('fund_holdings_lookthrough').primary).toContain('sec');
    expect(routeFor('energy_supply_positioning').primary).toContain('eia');
    expect(routeFor('shipping_ports').primary).toContain('imf_portwatch');
  });

  it('defines a last-known-good policy for every audited requirement', () => {
    for (const route of Object.values(PROVIDER_ROUTES)) {
      expect(route.allowLastKnownGood).toBe(true);
      expect(route.freshness.freshForMs).toBeGreaterThan(0);
      expect(route.freshness.staleUsableForMs).toBeGreaterThanOrEqual(route.freshness.freshForMs);
    }
  });
});

describe('data-plane snapshot freshness', () => {
  const policy = { freshForMs: 15 * 60_000, staleUsableForMs: 6 * 60 * 60_000 };
  const now = new Date('2026-08-31T14:00:00.000Z');

  it('separates fresh, stale-but-usable and expired states', () => {
    expect(classifySnapshotFreshness('2026-08-31T13:50:00.000Z', policy, now)).toBe('fresh');
    expect(classifySnapshotFreshness('2026-08-31T12:00:00.000Z', policy, now)).toBe('stale_usable');
    expect(classifySnapshotFreshness('2026-08-30T14:00:00.000Z', policy, now)).toBe('expired');
    expect(classifySnapshotFreshness('not-a-date', policy, now)).toBe('invalid');
  });

  it('keeps retained evidence usable only inside the explicit stale window', () => {
    const snapshot = createDataPlaneSnapshot({
      domain: 'portfolio',
      observedAt: '2026-08-31T12:00:00.000Z',
      capturedAt: '2026-08-31T12:01:00.000Z',
      providers: ['schwab'],
      primaryProvider: 'schwab',
      mode: 'retained',
      freshnessPolicy: policy,
      payload: { accounts: 2 },
    });
    expect(isSnapshotUsable(snapshot, now)).toBe(true);
    expect(isSnapshotUsable(snapshot, new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
  });

  it('never promotes explicitly unusable evidence merely because it is fresh', () => {
    const snapshot = createDataPlaneSnapshot({
      domain: 'market',
      observedAt: '2026-08-31T13:59:00.000Z',
      providers: ['openbb'],
      freshnessPolicy: policy,
      payload: {},
      usable: false,
      notes: ['Provider responded but required evidence was empty.'],
    });
    expect(classifySnapshotFreshness(snapshot.observedAt, snapshot.freshnessPolicy, now)).toBe('fresh');
    expect(isSnapshotUsable(snapshot, now)).toBe(false);
  });
});
