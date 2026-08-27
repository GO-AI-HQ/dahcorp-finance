import { json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildSimulation, type SimulatorRequest } from '../../src/services/analysis.js';

/**
 * POST /.netlify/functions/simulate
 *
 * Goal simulator. Runs the month-by-month projection under conservative, base
 * and aggressive assumptions and solves for the contribution required to hit
 * the target by 12 / 18 / 24 / 36 months. Every figure is solved, not tabulated.
 */
export default withErrorHandling('simulate', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = (await readJsonBody<SimulatorRequest>(req)) ?? {};
  const ctx = await buildServerContext();
  return json(buildSimulation(ctx, body));
});
