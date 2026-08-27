import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { buildIncomePayload } from '../../src/services/analysis.js';
import { priorIncomeSnapshot } from '../lib/store.mts';

/**
 * GET /.netlify/functions/income
 *
 * The income engine: received vs modeled cash flow, per-position distribution
 * statistics, self-buy ratios, the self-funding micro-milestone and the capital
 * required for each income target.
 */
export default withErrorHandling('income', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const ctx = await buildServerContext();
  const prior = await priorIncomeSnapshot(ctx.snapshot.asOf);
  return json(buildIncomePayload(ctx, prior?.forwardMonthlyIncome ?? null));
});
