import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { recordAudit } from '../lib/store.mts';
import {
  clearRobinhoodPendingAuth,
  loadRobinhoodOAuth,
  loadRobinhoodPendingAuth,
  saveRobinhoodOAuth,
} from '../lib/robinhoodOAuth.mts';
import { exchangeRobinhoodAuthorizationCode } from '../lib/robinhoodMcp.mts';

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

function loopbackMatches(actual: URL, expected: URL): boolean {
  if (actual.protocol !== 'http:' || expected.protocol !== 'http:') return false;
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  return (
    allowedHosts.has(actual.hostname) &&
    actual.hostname === expected.hostname &&
    actual.port === expected.port &&
    actual.pathname === expected.pathname
  );
}

/**
 * POST /.netlify/functions/robinhood-auth-complete
 *
 * Robinhood's MCP OAuth currently rejects some arbitrary remote HTTPS redirect
 * URIs. For the desktop loopback flow the user copies the one-time localhost
 * callback URL after approval and pastes it back into the private dashboard.
 * The code is still bound to the original PKCE verifier and random state held
 * server-side, and neither the code nor token is logged or returned.
 */
export default withErrorHandling('robinhood-auth-complete', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Robinhood cannot be connected in public demo mode.');

  const body = await readJsonBody<{ callbackUrl?: unknown }>(req);
  const callbackUrl = typeof body?.callbackUrl === 'string' ? body.callbackUrl.trim() : '';
  if (!callbackUrl) return fail(400, 'ROBINHOOD_CALLBACK_URL_REQUIRED', 'Paste the complete localhost callback URL from Robinhood.');

  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    return fail(400, 'ROBINHOOD_CALLBACK_URL_INVALID', 'The pasted Robinhood callback URL is not valid.');
  }

  const pending = await loadRobinhoodPendingAuth();
  if (!pending || pending.createdAt < Date.now() - 15 * 60_000) {
    return fail(409, 'ROBINHOOD_OAUTH_EXPIRED', 'The Robinhood authorization attempt expired. Start a new connection.');
  }

  let expected: URL;
  try {
    expected = new URL(pending.redirectUri);
  } catch {
    return fail(500, 'ROBINHOOD_OAUTH_REDIRECT_INVALID', 'The configured Robinhood OAuth redirect is invalid.');
  }
  if (!loopbackMatches(callback, expected)) {
    return fail(400, 'ROBINHOOD_CALLBACK_MISMATCH', 'The pasted URL does not match the expected Robinhood desktop callback.');
  }

  const providerError = callback.searchParams.get('error');
  if (providerError) {
    await clearRobinhoodPendingAuth();
    await recordAudit({
      category: 'auth',
      action: 'robinhood_oauth_denied',
      severity: 'warning',
      message: 'Robinhood authorization did not complete.',
    });
    return fail(400, 'ROBINHOOD_AUTHORIZATION_DENIED', 'Robinhood authorization was denied or could not be completed.');
  }

  const code = callback.searchParams.get('code');
  const state = callback.searchParams.get('state');
  if (!code || !state || !(await sameValue(state, pending.state))) {
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
    redirectUri: pending.redirectUri,
    scope: tokens.scope ?? pending.scope,
    tokens,
  });
  await clearRobinhoodPendingAuth();
  await recordAudit({
    category: 'auth',
    action: 'robinhood_connected',
    severity: 'info',
    message: 'Robinhood Trading MCP OAuth completed through the desktop loopback handoff and encrypted tokens were stored.',
  });

  return json({ connected: true, redirect: '/portfolio?robinhood=connected' });
});
