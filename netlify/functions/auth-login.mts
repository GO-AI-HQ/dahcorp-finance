import { fail, json, methodNotAllowed, readJsonBody, withErrorHandling } from '../lib/http.mts';
import { issueSessionCookie, liveCredentialsPresent, passcodeMatches, readSessionEnv } from '../lib/session.mts';
import { recordAudit } from '../lib/store.mts';

/**
 * POST /.netlify/functions/auth-login
 *
 * Exchanges the access passcode for a signed session cookie. The passcode is
 * never echoed, never logged and never stored client-side; only the HttpOnly
 * cookie leaves this function.
 */

/**
 * Per-instance attempt throttle. Not a substitute for a real rate limiter, but
 * it removes the cheap brute-force path against a short passcode.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;

function throttled(key: string, now: number): boolean {
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export default withErrorHandling('auth-login', async (req: Request) => {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const env = readSessionEnv();
  if (!env.passcode) {
    return fail(
      503,
      'SETUP_REQUIRED',
      'No access passcode is configured. Set DAHCORP_ACCESS_PASSCODE in the Netlify environment, then reload.',
      { setupRequired: true },
    );
  }

  const clientKey = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
  if (throttled(clientKey, Date.now())) {
    await recordAudit({
      category: 'auth',
      action: 'login_throttled',
      severity: 'warning',
      message: 'Too many failed sign-in attempts from one client.',
    });
    return fail(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes and try again.');
  }

  const body = await readJsonBody<{ passcode?: unknown }>(req);
  const candidate = typeof body?.passcode === 'string' ? body.passcode : '';
  if (!candidate || !(await passcodeMatches(candidate, env))) {
    await recordAudit({ category: 'auth', action: 'login_failed', severity: 'warning', message: 'Invalid passcode.' });
    return fail(401, 'INVALID_PASSCODE', 'That passcode is not correct.');
  }

  attempts.delete(clientKey);
  const cookie = await issueSessionCookie(env);
  await recordAudit({
    category: 'auth',
    action: 'login_succeeded',
    message: `Session issued for ${env.ttlMinutes} minutes.`,
    detail: { liveCredentialsConfigured: liveCredentialsPresent() },
  });

  return json({ authenticated: true, expiresInMinutes: env.ttlMinutes }, 200, { 'Set-Cookie': cookie });
});
