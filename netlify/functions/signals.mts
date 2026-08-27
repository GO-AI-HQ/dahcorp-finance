import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildSignalsPayload } from '../../src/services/analysis.js';

/**
 * GET /.netlify/functions/signals
 *
 * Deterministic signals only: trend confirmation, dip levels, harvest rules,
 * leveraged exposure, cash-flow-efficiency rankings and portfolio drag. No
 * language model is involved in producing any value on this endpoint.
 */
export default withErrorHandling('signals', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const ctx = await buildServerContext();
  return json(buildSignalsPayload(ctx));
});
