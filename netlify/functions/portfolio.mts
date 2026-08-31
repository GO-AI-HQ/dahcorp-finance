import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { loadPreparedAnalysisContext } from '../lib/preparedPortfolioSnapshot.mts';
import { buildPortfolioPayload } from '../../src/services/analysis.js';
import { priorIncomeSnapshot, recordIncomeSnapshot } from '../lib/store.mts';

/**
 * GET /.netlify/functions/portfolio
 *
 * The consolidated portfolio: totals, accounts, positions, sleeves, exposures,
 * milestone progress and income velocity. Ordinary navigation reads the last
 * verified prepared snapshot and recomputes deterministic analysis locally.
 * The live context is retained only as a cold-start fallback until the prepared
 * snapshot has been populated.
 */
export default withErrorHandling('portfolio', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const prepared = await loadPreparedAnalysisContext();
  const ctx = prepared ?? await buildServerContext();
  const prior = await priorIncomeSnapshot(ctx.snapshot.asOf);
  const payload = buildPortfolioPayload(ctx, prior?.forwardMonthlyIncome ?? null);

  // Record today's income position so velocity attribution has a baseline to
  // measure against next time. Best-effort: never blocks the response.
  await recordIncomeSnapshot({
    asOf: ctx.snapshot.asOf,
    forwardMonthlyIncome: ctx.income.forwardMonthlyIncome,
    incomeEngineCapital: ctx.income.incomeEngineCapital,
    blendedDistributionRate: ctx.income.blendedDistributionRate,
    portfolioValue: ctx.analysis.totals.totalValue,
    basis: ctx.config.distributionBasis,
    containsMockData: ctx.snapshot.containsMockData,
  });

  return json({
    ...payload,
    brokers: ctx.brokers,
    configPersisted: ctx.configPersisted,
    configNote: ctx.configNote,
    priorSnapshotAsOf: prior?.asOf ?? null,
    preparedSnapshot: prepared ? {
      observedAt: prepared.preparedAt,
      freshness: prepared.preparedFreshness,
    } : null,
    dataPlaneReadMode: prepared ? 'prepared_snapshot' : 'live_cold_start_fallback',
  });
});
