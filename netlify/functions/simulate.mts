import { json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { loadPreparedAnalysisContext } from '../lib/preparedPortfolioSnapshot.mts';
import { buildSimulation, type SimulatorRequest } from '../../src/services/analysis.js';
import { resolveStrategyLabBasis } from '../lib/strategyLabBasis.mts';

/**
 * POST /.netlify/functions/simulate
 *
 * Goal simulator. Slider changes run against the prepared portfolio/market
 * context and the durable Strategy Basis Snapshot. A live context is used only
 * when the prepared portfolio has never been populated, not on normal slider
 * interaction.
 */
export default withErrorHandling('simulate', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const body = (await readJsonBody<SimulatorRequest>(req)) ?? {};
  const prepared = await loadPreparedAnalysisContext();
  const ctx = prepared ?? await buildServerContext();
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
    dataPlaneReadMode: prepared ? 'prepared_strategy_basis' : 'live_cold_start_fallback',
  });
});
