import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { readSessionEnv, verifySession } from '../lib/session.mts';
import { databaseAvailable } from '../lib/store.mts';
import { modelAvailable, resolveModel } from '../lib/claude.mts';

/**
 * GET /.netlify/functions/auth-session
 *
 * Tells the client what mode it is in without revealing anything sensitive:
 * whether a session exists, whether setup is still required, and which
 * capabilities the environment has. No secret, key or token is included.
 */
export default withErrorHandling('auth-session', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);

  const env = readSessionEnv();
  const session = await verifySession(req, env);

  return json({
    authenticated: session.authenticated,
    mode: session.mode,
    setupRequired: session.setupRequired,
    publicDemo: session.publicDemo,
    expiresInSeconds: session.expiresInSeconds,
    sessionTtlMinutes: env.ttlMinutes,
    environment: {
      databaseAttached: databaseAvailable(),
      modelAvailable: modelAvailable(),
      model: modelAvailable() ? resolveModel() : null,
      executionEnabled: false,
      phase: 1,
    },
  });
});
