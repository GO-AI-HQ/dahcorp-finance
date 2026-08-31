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

/**
 * Some Netlify runtimes expose environment variables through process.env while
 * the lower-level intelligence module may only see Netlify.env. When a source
 * is configured but has not yet been tested in this request, show that honestly
 * as "waiting for a live check" rather than calling it live or not configured.
 */
function repairConfigurationLabels(payload: IntelligencePayload): IntelligencePayload {
  const configured = {
    openbb: Boolean(runtimeEnv('OPENBB_GATEWAY_URL') && runtimeEnv('OPENBB_GATEWAY_SIGNING_KEY')),
    finnhub: Boolean(runtimeEnv('FINNHUB_API_KEY')),
    ainvest: Boolean(runtimeEnv('AINVEST_API_KEY') || runtimeEnv('AINVEST_KEY')),
  };

  return {
    ...payload,
    providers: payload.providers.map((provider) => {
      const present = configured[provider.provider as keyof typeof configured];
      if (!present || provider.status !== 'not_configured') return provider;
      return {
        ...provider,
        connected: true,
        status: 'partial' as const,
        note: `${provider.provider.replace(/_/g, ' ')} is configured. Run a refresh to confirm that live data is actually returning.`,
      };
    }),
  };
}

/**
 * GET /.netlify/functions/intelligence
 *
 * Returns the market information used by the app. `?refresh=1` asks the live
 * providers for a fresh read. This endpoint never moves money or calls an LLM.
 */
export default withErrorHandling('intelligence', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';
  const limitRaw = Number(url.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;

  let payload = await buildMarketIntelligencePayload({ refresh, limit });

  // A newly connected provider can be healthy before its first scheduled data
  // pull. If every market lane is still empty, make one real refresh now rather
  // than asking the user to wait for the hourly job. If that refresh fails, keep
  // the provider's real failure state — never overwrite it with a green badge.
  const openbbConfigured = Boolean(runtimeEnv('OPENBB_GATEWAY_URL') && runtimeEnv('OPENBB_GATEWAY_SIGNING_KEY'));
  const marketPulseMissing = payload.marketPulse.length > 0 && payload.marketPulse.every((item) => item.dataRole === 'unavailable');
  if (!refresh && openbbConfigured && marketPulseMissing) {
    payload = await buildMarketIntelligencePayload({ refresh: true, limit });
  } else if (!refresh) {
    payload = repairConfigurationLabels(payload);
  }

  return json(payload);
});
