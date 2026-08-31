import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { loadStableAdvancedEvidenceFabric } from '../lib/intelligenceV3Stable.mts';
import { loadPreparedIntelligenceSnapshot, refreshPreparedIntelligenceSnapshot } from '../lib/preparedIntelligenceSnapshot.mts';

/**
 * GET /.netlify/functions/intelligence-v3
 * GET /.netlify/functions/intelligence-v3?refresh=1
 *
 * Returns the prepared eight-lane evidence snapshot. The prepared view includes
 * the expanded Finnhub earnings universe while preserving stable last-known-good
 * V3 lanes. Normal reads perform zero provider calls. The explicit refresh path
 * remains read-only and cannot invoke an LLM or broker write.
 */
export default withErrorHandling('intelligence-v3', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const url = new URL(req.url);
  if (url.searchParams.get('refresh') === '1') {
    const refreshed = await refreshPreparedIntelligenceSnapshot();
    return json({
      ...refreshed.payload.advancedEvidenceV3,
      finnhubExpandedEarnings: refreshed.payload.finnhubExpandedEarnings,
      preparedAt: refreshed.payload.builtAt,
      dataPlaneReadMode: 'explicit_refresh',
    });
  }

  const prepared = await loadPreparedIntelligenceSnapshot();
  if (prepared) {
    return json({
      ...prepared.payload.advancedEvidenceV3,
      finnhubExpandedEarnings: prepared.payload.finnhubExpandedEarnings,
      preparedAt: prepared.payload.builtAt,
      preparedFreshness: prepared.freshness,
      dataPlaneReadMode: 'prepared_snapshot',
    });
  }

  // Cold-start compatibility while the first scheduled prepared refresh has not
  // yet run. This reads the already persisted stable V3 ledger and does not call
  // external providers.
  return json({
    ...await loadStableAdvancedEvidenceFabric(),
    finnhubExpandedEarnings: null,
    preparedAt: null,
    dataPlaneReadMode: 'stable_ledger_cold_start',
  });
});
