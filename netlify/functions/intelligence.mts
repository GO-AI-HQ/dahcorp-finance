import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildMarketIntelligencePayload } from '../lib/intelligenceEngine.mts';

/**
 * GET /.netlify/functions/intelligence
 *
 * Returns normalized market/policy/capital evidence. `?refresh=1` performs a
 * provider refresh before reading the event ledger. No LLM and no broker write
 * are invoked from this endpoint.
 */
export default withErrorHandling('intelligence', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';
  const limitRaw = Number(url.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;
  return json(await buildMarketIntelligencePayload({ refresh, limit }));
});
