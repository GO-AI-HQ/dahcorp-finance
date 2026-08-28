import { fail, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { readSchwabConfig } from '../../src/brokers/schwab/adapter.js';

const STATE_COOKIE = 'dahcorp_schwab_oauth_state';

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** GET /.netlify/functions/schwab-auth-start */
export default withErrorHandling('schwab-auth-start', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { session, response } = await requireSession(req);
  if (response) return response;
  if (session.mode === 'public_demo') return fail(403, 'READ_ONLY_DEMO', 'Schwab cannot be connected in public demo mode.');

  const config = readSchwabConfig(process.env as Record<string, string | undefined>);
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return fail(
      503,
      'SCHWAB_OAUTH_NOT_CONFIGURED',
      'Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET and SCHWAB_CALLBACK_URL before connecting Schwab.',
    );
  }

  const state = randomState();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${config.baseUrl}/v1/oauth/authorize?${params.toString()}`,
      'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/.netlify/functions/schwab-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
});
