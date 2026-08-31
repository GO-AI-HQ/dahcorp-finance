import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { dataPlaneSnapshotStatus } from '../lib/dataPlaneSnapshotStore.mts';
import { PROVIDER_ROUTES } from '../../src/data/dataPlane.js';

/**
 * Internal hardening diagnostic. It exposes no credentials and performs no
 * provider network calls. The endpoint reports only the routing contract and
 * the state/age of durable DAHCorp snapshots so reliability can be measured
 * independently from page rendering.
 */
export default withErrorHandling('data-plane-status', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const snapshots = await dataPlaneSnapshotStatus();
  const routes = Object.fromEntries(Object.entries(PROVIDER_ROUTES).map(([requirement, route]) => [requirement, {
    domain: route.domain,
    primary: route.primary,
    secondary: route.secondary,
    allowLastKnownGood: route.allowLastKnownGood,
    freshness: route.freshness,
    note: route.note,
  }]));

  const domains = Object.values(snapshots);
  const usableDomains = domains.filter((row) => row.usable).length;

  return json({
    version: 'data-plane-v1',
    targetUsableStatePct: 95,
    generatedAt: new Date().toISOString(),
    summary: {
      domainsPresent: domains.filter((row) => row.present).length,
      domainsUsable: usableDomains,
      totalDomains: domains.length,
    },
    snapshots,
    routes,
    semantics: {
      providerConnectionIsNotRouteHealth: true,
      routeHealthIsNotSnapshotPopulation: true,
      snapshotPopulationIsNotFreshness: true,
      retainedEvidenceIsNeverExecutionPricing: true,
      unknownIsNeverZero: true,
    },
  });
});
