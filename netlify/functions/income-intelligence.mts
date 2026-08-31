import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { loadIncomeIntelligence } from '../lib/incomeIntelligence.mts';

const EMPTY = {
  version: 'income-v1' as const,
  asOf: null,
  upcoming: [],
  candidates: [],
  sourceStatus: { calendar: 'unavailable' as const, screener: 'unavailable' as const, distributions: 'unavailable' as const },
  callsUsed: 0,
  note: 'No income-research snapshot is stored yet. The scheduled research refresh will build one without using provider calls from your browser session.',
};

/**
 * Read the stored income-research snapshot.
 *
 * GET and POST are intentionally cache-only. Browser actions never initiate an
 * FMP network request; only scheduled server jobs are permitted to spend the
 * provider call budget. POST remains accepted so older clients can safely use
 * the existing refresh button without creating a provider-call storm.
 */
export default withErrorHandling('income-intelligence', async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(['GET', 'POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  const stored = await loadIncomeIntelligence();
  if (!stored) return json(EMPTY);
  return json(req.method === 'POST'
    ? { ...stored, note: `${stored.note} Browser refresh reloaded stored research and used zero FMP calls.` }
    : stored);
});