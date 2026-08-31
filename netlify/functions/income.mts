import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext, type ServerContext } from '../lib/context.mts';
import { loadPreparedAnalysisContext } from '../lib/preparedPortfolioSnapshot.mts';
import { buildIncomePayload } from '../../src/services/analysis.js';
import { priorIncomeSnapshot } from '../lib/store.mts';
import { incomeIntelligenceForContext } from '../lib/incomeIntelligence.mts';

/**
 * GET /.netlify/functions/income
 *
 * The income engine: received vs modeled cash flow, per-position distribution
 * statistics, self-buy ratios, the self-funding micro-milestone and the capital
 * required for each income target. Stored income discovery is joined to the
 * same verified prepared context without making a new market-data request.
 */
export default withErrorHandling('income', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const prepared = await loadPreparedAnalysisContext();
  const ctx = prepared ?? await buildServerContext();
  const [prior, incomeIntelligence] = await Promise.all([
    priorIncomeSnapshot(ctx.snapshot.asOf),
    incomeIntelligenceForContext(ctx as ServerContext),
  ]);
  return json({
    ...buildIncomePayload(ctx, prior?.forwardMonthlyIncome ?? null),
    incomeIntelligence,
    preparedSnapshot: prepared ? {
      observedAt: prepared.preparedAt,
      freshness: prepared.preparedFreshness,
    } : null,
    dataPlaneReadMode: prepared ? 'prepared_snapshot' : 'live_cold_start_fallback',
  });
});
