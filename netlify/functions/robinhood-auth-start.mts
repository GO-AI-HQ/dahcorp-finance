import { fail, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { recordAudit } from '../lib/store.mts';
import { saveRobinhoodPendingAuth } from '../lib/robinhoodOAuth.mts';
import {
  discoverRobinhoodOAuth,
  ensureRobinhoodClient,
  robinhoodOAuthRedirectUrl,
  robinhoodResource,
} from '../lib/robinhoodMcp.mts';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomValue(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function codeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** GET /.netlify/functions/robinhood-auth-start */
export default withErrorHandling('robinhood-auth-start', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Robinhood cannot be connected in public demo mode.');

  const redirectUri = robinhoodOAuthRedirectUrl();
  if (!redirectUri) {
    return fail(503, 'ROBINHOOD_OAUTH_NOT_CONFIGURED', 'Set ROBINHOOD_CALLBACK_URL or ROBINHOOD_OAUTH_REDIRECT_URI before connecting Robinhood.');
  }

  const discovery = await discoverRobinhoodOAuth(robinhoodResource());
  const client = await ensureRobinhoodClient(discovery, redirectUri);
  const state = randomValue(32);
  const verifier = randomValue(64);
  const challenge = await codeChallenge(verifier);

  await saveRobinhoodPendingAuth({
    state,
    codeVerifier: verifier,
    clientId: client.clientId,
    resource: discovery.resource,
    authorizationEndpoint: discovery.authorizationEndpoint,
    tokenEndpoint: discovery.tokenEndpoint,
    registrationEndpoint: discovery.registrationEndpoint,
    redirectUri,
    scope: discovery.scope,
    createdAt: Date.now(),
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: discovery.resource,
  });
  if (discovery.scope) params.set('scope', discovery.scope);

  await recordAudit({
    category: 'auth',
    action: 'robinhood_oauth_started',
    severity: 'info',
    message: 'Robinhood Trading MCP OAuth authorization was started.',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${discovery.authorizationEndpoint}?${params.toString()}`,
      'Cache-Control': 'no-store',
    },
  });
});
