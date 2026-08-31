import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { loadStableAdvancedEvidenceFabric, refreshStableAdvancedEvidenceFabric } from '../lib/intelligenceV3Stable.mts';

/**
 * GET /.netlify/functions/intelligence-v3
 * GET /.netlify/functions/intelligence-v3?refresh=1
 *
 * Returns the latest stable eight-lane evidence snapshot. A temporary provider
 * miss can retain a recent verified lane as partial evidence, but never as live.
 * The optional refresh remains read-only and never invokes an LLM or broker write.
 */
export default withErrorHandling('intelligence-v3', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const url = new URL(req.url);
  if (url.searchParams.get('refresh') === '1') {
    return json(await refreshStableAdvancedEvidenceFabric());
  }
  return json(await loadStableAdvancedEvidenceFabric());
});
