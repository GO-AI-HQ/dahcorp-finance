import { fail, json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { historicalRelevanceFor } from '../lib/intelligenceStore.mts';
import type { IntelligenceEventType, IntelligenceSector } from '../../src/intelligence/types.js';

const SECTORS = new Set(['semiconductors', 'energy', 'shipping', 'technology', 'cross_market']);

export default withErrorHandling('historical-relevance', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;
  const url = new URL(req.url);
  const eventType = url.searchParams.get('eventType')?.trim() || '';
  const sector = url.searchParams.get('sector')?.trim() || '';
  if (!eventType || !SECTORS.has(sector)) return fail(400, 'INVALID_HISTORICAL_RELEVANCE', 'A valid event type and sector are required.');
  return json(await historicalRelevanceFor(eventType as IntelligenceEventType, sector as IntelligenceSector));
});
