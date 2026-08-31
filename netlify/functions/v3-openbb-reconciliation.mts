import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { OpenBBGatewayError, SignedOpenBBGatewayClient } from '../lib/openbbGatewayClient.mts';
import { loadPreparedIntelligenceSnapshot } from '../lib/preparedIntelligenceSnapshot.mts';
import { loadStableAdvancedEvidenceFabric } from '../lib/intelligenceV3Stable.mts';
import type { AdvancedEvidenceFabric } from '../lib/intelligenceV3.mts';

type OpenBbLane = 'options' | 'fund_lookthrough' | 'maritime' | 'energy_positioning' | 'filings_insiders' | 'crowding';
type RouteState = 'working_rows' | 'working_empty' | 'failed' | 'not_configured';

interface ProbeDefinition {
  lane: OpenBbLane;
  label: string;
  path: string;
  params: () => URLSearchParams;
  scopeNote: string;
}

function day(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

const PROBES: ProbeDefinition[] = [
  {
    lane: 'options',
    label: 'AMD options chain',
    path: '/v3/options/chains',
    params: () => new URLSearchParams({ symbol: 'AMD' }),
    scopeNote: 'Representative route probe; the V3 lane still requires normalized evidence across its configured symbol set.',
  },
  {
    lane: 'fund_lookthrough',
    label: 'SMH N-PORT look-through',
    path: '/v3/fund/nport',
    params: () => new URLSearchParams({ symbol: 'SMH' }),
    scopeNote: 'Representative fund route probe; disclosure timing can legitimately return no current rows.',
  },
  {
    lane: 'maritime',
    label: 'Shipping chokepoints',
    path: '/v3/shipping/chokepoints',
    params: () => new URLSearchParams({ start_date: day(45), end_date: day() }),
    scopeNote: 'Representative physical-flow route; the full lane also includes country port calls.',
  },
  {
    lane: 'energy_positioning',
    label: 'EIA petroleum',
    path: '/v3/energy/petroleum',
    params: () => new URLSearchParams({ category: 'weekly_estimates', start_date: day(120), end_date: day() }),
    scopeNote: 'Representative energy route; the full lane also requires STEO and CFTC evidence.',
  },
  {
    lane: 'filings_insiders',
    label: 'AMD SEC MD&A',
    path: '/v3/sec/mdna',
    params: () => new URLSearchParams({ symbol: 'AMD' }),
    scopeNote: 'Representative SEC route; the full lane also requires insider evidence across its configured company set.',
  },
  {
    lane: 'crowding',
    label: 'AMD short interest',
    path: '/v3/short-interest',
    params: () => new URLSearchParams({ symbol: 'AMD' }),
    scopeNote: 'Representative FINRA/OpenBB route; short-interest publication cadence is not real-time.',
  },
];

function safeFailure(error: unknown): { reason: string; httpStatus: number | null } {
  if (error instanceof OpenBBGatewayError) {
    return {
      httpStatus: error.status,
      reason: error.status == null ? 'OpenBB gateway request failed.' : `OpenBB gateway returned HTTP ${error.status}.`,
    };
  }
  return { httpStatus: null, reason: 'OpenBB route could not be verified.' };
}

async function probe(client: SignedOpenBBGatewayClient, definition: ProbeDefinition) {
  if (!client.isConfigured()) {
    return {
      lane: definition.lane,
      label: definition.label,
      routeState: 'not_configured' as RouteState,
      resultCount: null,
      httpStatus: null,
      reason: 'Signed OpenBB access is not configured.',
      scopeNote: definition.scopeNote,
    };
  }
  try {
    const response = await client.get<Record<string, unknown>>(definition.path, definition.params());
    const results = Array.isArray(response.results) ? response.results.length : 0;
    return {
      lane: definition.lane,
      label: definition.label,
      routeState: (results > 0 ? 'working_rows' : 'working_empty') as RouteState,
      resultCount: results,
      httpStatus: 200,
      reason: results > 0
        ? `The signed route returned ${results} row${results === 1 ? '' : 's'}.`
        : 'The signed route succeeded but returned no rows for this representative probe.',
      scopeNote: definition.scopeNote,
    };
  } catch (error) {
    const failure = safeFailure(error);
    return {
      lane: definition.lane,
      label: definition.label,
      routeState: 'failed' as RouteState,
      resultCount: null,
      ...failure,
      scopeNote: definition.scopeNote,
    };
  }
}

function verdict(routeState: RouteState, lane: AdvancedEvidenceFabric['lanes'][OpenBbLane]['status']): string {
  if (routeState === 'not_configured') return lane === 'unavailable' ? 'not_configured' : 'retained_lane_without_current_route';
  if (routeState === 'working_rows') return lane === 'unavailable' ? 'route_working_lane_unpopulated' : 'route_and_lane_aligned';
  if (routeState === 'working_empty') return lane === 'unavailable' ? 'route_working_no_rows' : 'lane_retained_or_populated_from_other_requests';
  return lane === 'unavailable' ? 'route_and_lane_unavailable' : 'lane_retained_last_known_good';
}

/**
 * Explicit diagnostic only. This endpoint deliberately performs representative
 * OpenBB calls so route health can be compared with the already-persisted V3
 * lane state. Normal Portfolio/Income/Strategy/V3 reads do not invoke it.
 */
export default withErrorHandling('v3-openbb-reconciliation', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const prepared = await loadPreparedIntelligenceSnapshot();
  const fabric = prepared?.payload.advancedEvidenceV3 ?? await loadStableAdvancedEvidenceFabric();
  const client = new SignedOpenBBGatewayClient();
  const probes = await Promise.all(PROBES.map((definition) => probe(client, definition)));
  const reconciliation = probes.map((route) => ({
    ...route,
    laneStatus: fabric.lanes[route.lane].status,
    laneItemCount: fabric.lanes[route.lane].itemCount,
    laneAsOf: fabric.lanes[route.lane].asOf,
    laneCaveats: fabric.lanes[route.lane].caveats,
    verdict: verdict(route.routeState, fabric.lanes[route.lane].status),
  }));

  return json({
    asOf: new Date().toISOString(),
    preparedEvidenceAsOf: fabric.asOf,
    preparedEvidenceFreshness: prepared?.freshness ?? null,
    reconciliation,
    summary: {
      routeWorkingLaneUnpopulated: reconciliation.filter((row) => row.verdict === 'route_working_lane_unpopulated').map((row) => row.lane),
      retainedLanesWithCurrentRouteFailure: reconciliation.filter((row) => row.verdict === 'lane_retained_last_known_good').map((row) => row.lane),
      aligned: reconciliation.filter((row) => row.verdict === 'route_and_lane_aligned').map((row) => row.lane),
    },
    note: 'A working route proves connectivity, not usable V3 lane population. route_working_lane_unpopulated means transport succeeded but the full V3 refresh produced no normalized evidence; investigate provider/data coverage or normalization rather than authentication.',
  });
});
