import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { loadAdvancedEvidenceFabric, refreshAdvancedEvidenceFabric } from '../lib/intelligenceV3.mts';

/**
 * GET /.netlify/functions/intelligence-v3
 * GET /.netlify/functions/intelligence-v3?refresh=1
 *
 * Returns the latest structured eight-lane evidence snapshot. The optional
 * refresh remains read-only and never invokes an LLM or broker write.
 */
export default withErrorHandling('intelligence-v3', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const url = new URL(req.url);
  if (url.searchParams.get('refresh') === '1') {
    const { fabric } = await refreshAdvancedEvidenceFabric();
    return json(fabric);
  }
  return json(await loadAdvancedEvidenceFabric());
});
