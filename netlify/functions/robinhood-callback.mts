import { fail, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { recordAudit } from '../lib/store.mts';
import {
  clearRobinhoodPendingAuth,
  loadRobinhoodOAuth,
  loadRobinhoodPendingAuth,
  saveRobinhoodOAuth,
} from '../lib/robinhoodOAuth.mts';
import { exchangeRobinhoodAuthorizationCode } from '../lib/robinhoodMcp.mts';

const STATE_COOKIE = 'dahcorp_robinhood_oauth_state';

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
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

/** GET /.netlify/functions/robinhood-callback */
export default withErrorHandling('robinhood-callback', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const url = new URL(req.url);
  const providerError = url.searchParams.get('error');
  if (providerError) {
    await clearRobinhoodPendingAuth();
    await recordAudit({ category: 'auth', action: 'robinhood_oauth_denied', severity: 'warning', message: 'Robinhood authorization did not complete.' });
    return fail(400, 'ROBINHOOD_AUTHORIZATION_DENIED', 'Robinhood authorization was denied or could not be completed.');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(req, STATE_COOKIE);
  const pending = await loadRobinhoodPendingAuth();
  if (
    !code || !state || !cookieState || !pending ||
    pending.createdAt < Date.now() - 15 * 60_000 ||
    !(await sameValue(state, cookieState)) ||
    !(await sameValue(state, pending.state))
  ) {
    return fail(400, 'ROBINHOOD_OAUTH_STATE_INVALID', 'The Robinhood authorization callback could not be verified. Start the connection again.');
  }

  const tokens = await exchangeRobinhoodAuthorizationCode({
    code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
    clientId: pending.clientId,
    tokenEndpoint: pending.tokenEndpoint,
    resource: pending.resource,
    scope: pending.scope,
  });
  const existing = await loadRobinhoodOAuth();
  await saveRobinhoodOAuth({
    clientId: pending.clientId,
    resource: pending.resource,
    authorizationEndpoint: pending.authorizationEndpoint,
    tokenEndpoint: pending.tokenEndpoint,
    registrationEndpoint: pending.registrationEndpoint ?? existing?.registrationEndpoint,
    scope: tokens.scope ?? pending.scope,
    tokens,
  });
  await clearRobinhoodPendingAuth();
  await recordAudit({
    category: 'auth',
    action: 'robinhood_connected',
    severity: 'info',
    message: 'Robinhood Trading MCP OAuth completed and encrypted tokens were stored.',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/portfolio?robinhood=connected',
      'Set-Cookie': `${STATE_COOKIE}=; Path=/.netlify/functions/robinhood-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      'Cache-Control': 'no-store',
    },
  });
});
