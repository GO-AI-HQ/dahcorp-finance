import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { OpenBBGatewayError, SignedOpenBBGatewayClient } from '../lib/openbbGatewayClient.mts';

type CheckState = 'working' | 'warning' | 'blocked' | 'not_configured';

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

function explanationFor(error: unknown, label: string): { state: CheckState; detail: string; httpStatus: number | null } {
  if (error instanceof OpenBBGatewayError) {
    if (error.status === 401) {
      return {
        state: 'blocked',
        httpStatus: 401,
        detail: `${label} was rejected by the Google gateway. DAHCorp's signing identity and the gateway's public verification key do not match. Redeploy the latest gateway build in Cloud Run.`,
      };
    }
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return {
        state: 'blocked',
        httpStatus: error.status,
        detail: `${label} reached the Google gateway, but the gateway could not complete the private OpenBB request. Check the Cloud Run service account and the private OpenBB service.`,
      };
    }
    if (error.status === 404) {
      return {
        state: 'warning',
        httpStatus: 404,
        detail: `${label} authenticated successfully, but that route or upstream OpenBB capability is not present in the running gateway build.`,
      };
    }
    return {
      state: 'warning',
      httpStatus: error.status,
      detail: `${label} returned ${error.status ? `HTTP ${error.status}` : 'a connection error'}. Authentication may be working, but this data lane is not usable yet.`,
    };
  }
  return { state: 'warning', httpStatus: null, detail: `${label} could not be verified right now.` };
}

async function signedProbe(client: SignedOpenBBGatewayClient, label: string, path: string, params: URLSearchParams) {
  try {
    const payload = await client.get<Record<string, unknown>>(path, params);
    const results = Array.isArray(payload.results) ? payload.results.length : null;
    return {
      label,
      state: 'working' as const,
      httpStatus: 200,
      detail: results == null ? `${label} is responding through the signed Google gateway.` : `${label} is responding through the signed Google gateway (${results} result${results === 1 ? '' : 's'} in this probe).`,
    };
  } catch (error) {
    return { label, ...explanationFor(error, label) };
  }
}

export default withErrorHandling('intelligence-diagnostics', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const gatewayUrl = runtimeEnv('OPENBB_GATEWAY_URL')?.trim() || '';
  const dedicatedSigningKeyPresent = Boolean(runtimeEnv('OPENBB_GATEWAY_SIGNING_KEY')?.trim());
  const sessionSecretPresent = Boolean(runtimeEnv('DAHCORP_SESSION_SECRET')?.trim());
  const signingIdentityPresent = dedicatedSigningKeyPresent || sessionSecretPresent;
  const finnhubPresent = Boolean(runtimeEnv('FINNHUB_API_KEY')?.trim());
  const rateApiPresent = Boolean(runtimeEnv('RATEAPI_API_KEY')?.trim());
  const client = new SignedOpenBBGatewayClient();

  let gatewayHealth: { label: string; state: CheckState; httpStatus: number | null; detail: string };
  if (!gatewayUrl) {
    gatewayHealth = { label: 'Google gateway', state: 'not_configured', httpStatus: null, detail: 'The Google gateway address is not configured in Netlify.' };
  } else {
    try {
      const response = await fetch(`${gatewayUrl.replace(/\/$/, '')}/v3/health`, { headers: { Accept: 'application/json' } });
      gatewayHealth = response.ok
        ? { label: 'Google gateway', state: 'working', httpStatus: response.status, detail: 'The Google-hosted gateway is online.' }
        : { label: 'Google gateway', state: 'warning', httpStatus: response.status, detail: `The Google-hosted gateway answered with HTTP ${response.status}.` };
    } catch {
      gatewayHealth = { label: 'Google gateway', state: 'blocked', httpStatus: null, detail: 'DAHCorp could not reach the Google-hosted gateway.' };
    }
  }

  const checks = [gatewayHealth];
  if (!client.isConfigured()) {
    checks.push({
      label: 'Signed OpenBB access',
      state: 'not_configured' as const,
      httpStatus: null,
      detail: gatewayUrl
        ? 'The Google gateway is online, but DAHCorp has no signing identity available for private OpenBB data requests.'
        : 'The Google gateway address is missing.',
    });
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 12 * 86_400_000).toISOString().slice(0, 10);
    checks.push(...await Promise.all([
      signedProbe(client, 'Quotes and price data', '/v1/quote', new URLSearchParams({ symbol: 'AMD', provider: 'yfinance' })),
      signedProbe(client, 'Macro and FRED data', '/v2/fred/series', new URLSearchParams({ series: 'DGS10', start_date: start, end_date: today })),
      signedProbe(client, 'V3 options evidence', '/v3/options/chains', new URLSearchParams({ symbol: 'AMD' })),
    ]));
  }

  const blocked = checks.find((check) => check.state === 'blocked');
  const warning = checks.find((check) => check.state === 'warning');
  const overall: CheckState = blocked ? 'blocked' : warning ? 'warning' : checks.some((check) => check.state === 'not_configured') ? 'not_configured' : 'working';

  return json({
    asOf: new Date().toISOString(),
    overall,
    configuration: {
      gatewayAddressPresent: Boolean(gatewayUrl),
      signingKeyPresent: signingIdentityPresent,
      finnhubPresent,
      rateApiPresent,
    },
    checks,
    nextStep: blocked?.detail ?? warning?.detail ?? (overall === 'working'
      ? 'The connection path is working. Refresh Market to populate the latest V2 and V3 research.'
      : 'Finish the missing configuration, then run this check again.'),
    note: 'This diagnostic reports only connection state. It never returns API keys, signing material or broker credentials.',
  });
});
