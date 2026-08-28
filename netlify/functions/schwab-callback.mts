import { fail, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { readSchwabConfig } from '../../src/brokers/schwab/adapter.js';
import { recordAudit } from '../lib/store.mts';
import { saveSchwabRefreshToken } from '../lib/schwabTokens.mts';

const STATE_COOKIE = 'dahcorp_schwab_oauth_state';

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function sameValue(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

/** GET /.netlify/functions/schwab-callback */
export default withErrorHandling('schwab-callback', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);

  const url = new URL(req.url);
  const providerError = url.searchParams.get('error');
  if (providerError) {
    await recordAudit({
      category: 'auth',
      action: 'schwab_oauth_denied',
      severity: 'warning',
      message: 'Schwab authorization did not complete.',
    });
    return fail(400, 'SCHWAB_AUTHORIZATION_DENIED', 'Schwab authorization was denied or could not be completed.');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(req, STATE_COOKIE);
  if (!code || !state || !expectedState || !(await sameValue(state, expectedState))) {
    return fail(400, 'SCHWAB_OAUTH_STATE_INVALID', 'The Schwab authorization callback could not be verified. Start the connection again.');
  }

  const config = readSchwabConfig(process.env as Record<string, string | undefined>);
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return fail(503, 'SCHWAB_OAUTH_NOT_CONFIGURED', 'Schwab OAuth environment variables are incomplete.');
  }

  const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
  const tokenResponse = await fetch(`${config.baseUrl}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    await recordAudit({
      category: 'auth',
      action: 'schwab_token_exchange_failed',
      severity: 'error',
      message: `Schwab token exchange failed with status ${tokenResponse.status}.`,
    });
    return fail(502, 'SCHWAB_TOKEN_EXCHANGE_FAILED', 'Schwab did not accept the authorization-code exchange.');
  }

  const payload = (await tokenResponse.json()) as { refresh_token?: string };
  if (!payload.refresh_token) {
    return fail(502, 'SCHWAB_REFRESH_TOKEN_MISSING', 'Schwab returned no refresh token. Authorize the connection again.');
  }

  await saveSchwabRefreshToken(payload.refresh_token);
  await recordAudit({
    category: 'auth',
    action: 'schwab_connected',
    severity: 'info',
    message: 'Schwab OAuth authorization completed and the encrypted refresh token was stored.',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/portfolio?schwab=connected',
      'Set-Cookie': `${STATE_COOKIE}=; Path=/.netlify/functions/schwab-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      'Cache-Control': 'no-store',
    },
  });
});
