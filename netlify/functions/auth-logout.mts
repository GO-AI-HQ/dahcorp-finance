import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { clearSessionCookie } from '../lib/session.mts';
import { recordAudit } from '../lib/store.mts';

/** POST /.netlify/functions/auth-logout — clears the session cookie. */
export default withErrorHandling('auth-logout', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  await recordAudit({ category: 'auth', action: 'logout', message: 'Session cleared.' });
  return json({ authenticated: false }, 200, { 'Set-Cookie': clearSessionCookie() });
});
