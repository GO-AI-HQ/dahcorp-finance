import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { loadIncomeIntelligence, refreshIncomeIntelligence } from '../lib/incomeIntelligence.mts';

/**
 * Read the stored income-research snapshot or deliberately request a fresh
 * research pass. Both paths are read-only: they cannot change the portfolio,
 * settings, allowlists or broker state.
 */
export default withErrorHandling('income-intelligence', async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(['GET', 'POST']);
  const { response } = await requireSession(req);
  if (response) return response;

  if (req.method === 'POST') {
    const { snapshot } = await refreshIncomeIntelligence();
    return json(snapshot);
  }

  return json((await loadIncomeIntelligence()) ?? {
    version: 'income-v1',
    asOf: null,
    upcoming: [],
    candidates: [],
    sourceStatus: { calendar: 'unavailable', screener: 'unavailable', distributions: 'unavailable' },
    callsUsed: 0,
    note: 'No income-research snapshot is stored yet. The daily refresh will build one, or you can request a fresh research pass from the Income page.',
  });
});
