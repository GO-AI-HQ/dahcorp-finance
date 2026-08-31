import { json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildSimulation, type SimulatorRequest } from '../../src/services/analysis.js';
import { resolveStrategyLabBasis } from '../lib/strategyLabBasis.mts';

/**
 * POST /.netlify/functions/simulate
 *
 * Goal simulator. The planning basis is deliberately steadier than execution
 * pricing: slider changes compare the same verified distribution-rate evidence
 * rather than rebuilding the chart around a transient provider miss.
 */
export default withErrorHandling('simulate', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = (await readJsonBody<SimulatorRequest>(req)) ?? {};
  const ctx = await buildServerContext();
  const basis = await resolveStrategyLabBasis(ctx);
  const requestedBasis = typeof body.basisOverrideRate === 'number' && Number.isFinite(body.basisOverrideRate) && body.basisOverrideRate > 0
    ? body.basisOverrideRate
    : basis.rate;
  const simulation = buildSimulation(ctx, {
    ...body,
    basisOverrideRate: requestedBasis ?? undefined,
  });

  return json({
    ...simulation,
    incomeEvidenceStatus: basis.status,
    incomeEvidenceAsOf: basis.asOf,
    incomeEvidenceNote: basis.note,
  });
});
