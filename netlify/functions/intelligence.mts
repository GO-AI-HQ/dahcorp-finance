import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildMarketIntelligencePayload } from '../lib/intelligenceEngine.mts';
import type { IntelligencePayload } from '../../src/intelligence/types.js';

function runtimeEnv(key: string): string | undefined {
  if (process.env[key] != null) return process.env[key];
  try {
    const netlify = (globalThis as typeof globalThis & {
      Netlify?: { env?: { get?: (name: string) => string | undefined } };
    }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

function repairProviderStatus(payload: IntelligencePayload): IntelligencePayload {
  const openbbConfigured = Boolean(runtimeEnv('OPENBB_GATEWAY_URL') && runtimeEnv('OPENBB_GATEWAY_SIGNING_KEY'));
  const finnhubConfigured = Boolean(runtimeEnv('FINNHUB_API_KEY'));
  const ainvestConfigured = Boolean(runtimeEnv('AINVEST_API_KEY') || runtimeEnv('AINVEST_KEY'));

  return {
    ...payload,
    providers: payload.providers.map((provider) => {
      if (provider.provider === 'openbb' && openbbConfigured) {
        return {
          ...provider,
          connected: true,
          status: 'live' as const,
          note: 'OpenBB is connected through the signed Google Cloud gateway. Individual datasets can still be waiting on their next refresh.',
        };
      }
      if (provider.provider === 'finnhub' && finnhubConfigured) {
        return {
          ...provider,
          connected: true,
          status: 'live' as const,
          note: 'Finnhub is connected for ticker reference data and company/event research. Some fields update on their own provider schedule.',
        };
      }
      if (provider.provider === 'ainvest' && ainvestConfigured) {
        return { ...provider, connected: true, status: 'live' as const };
      }
      return provider;
    }),
  };
}

/**
 * GET /.netlify/functions/intelligence
 *
 * Returns normalized market/policy/capital evidence. `?refresh=1` performs a
 * provider refresh before reading the event ledger. No LLM and no broker write
 * are invoked from this endpoint.
 */
export default withErrorHandling('intelligence', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';
  const limitRaw = Number(url.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;

  let payload = repairProviderStatus(await buildMarketIntelligencePayload({ refresh, limit }));

  // A healthy new gateway can come online before the first scheduled market
  // pulse has been saved. Bootstrap that evidence once instead of leaving the
  // market-weather strip empty for up to an hour. Missing data still stays
  // UNKNOWN; no mock or fixture values are introduced.
  const openbbConfigured = Boolean(runtimeEnv('OPENBB_GATEWAY_URL') && runtimeEnv('OPENBB_GATEWAY_SIGNING_KEY'));
  const marketPulseMissing = payload.marketPulse.length > 0 && payload.marketPulse.every((item) => item.dataRole === 'unavailable');
  if (!refresh && openbbConfigured && marketPulseMissing) {
    payload = repairProviderStatus(await buildMarketIntelligencePayload({ refresh: true, limit }));
  }

  return json(payload);
});
