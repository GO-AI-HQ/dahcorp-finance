/**
 * Single-investor authentication.
 *
 * The whole dashboard sits behind a passcode held in a Netlify environment
 * variable. A successful login issues an HMAC-signed, HttpOnly, Secure,
 * SameSite=Strict cookie carrying nothing but an issue time and an expiry — no
 * portfolio data, no broker tokens, nothing readable by JavaScript.
 *
 * Design rules enforced here:
 *   - No token of any kind is ever returned in a response body.
 *   - No secret is ever logged.
 *   - With no passcode configured the API is LOCKED, not open. The only way to
 *     serve unauthenticated traffic is the explicit DAHCORP_ALLOW_PUBLIC_DEMO
 *     opt-in, which additionally refuses to run if any live broker credential
 *     is present.
 */
import { fail } from './http.mts';

const COOKIE_NAME = 'dahcorp_session';
const DEFAULT_TTL_MINUTES = 60;
const encoder = new TextEncoder();

export interface SessionEnvironment {
  passcode: string | undefined;
  sessionSecret: string | undefined;
  ttlMinutes: number;
  publicDemo: boolean;
}

export function readSessionEnv(env: NodeJS.ProcessEnv = process.env): SessionEnvironment {
  const ttl = Number(env.DAHCORP_SESSION_TTL_MINUTES);
  return {
    passcode: env.DAHCORP_ACCESS_PASSCODE?.trim() || undefined,
    sessionSecret: env.DAHCORP_SESSION_SECRET?.trim() || undefined,
    ttlMinutes: Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, 60 * 24) : DEFAULT_TTL_MINUTES,
    publicDemo: (env.DAHCORP_ALLOW_PUBLIC_DEMO ?? '').toLowerCase() === 'true',
  };
}

/** True when any live brokerage or model credential is configured. */
export function liveCredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.SCHWAB_CLIENT_ID ||
      env.SCHWAB_CLIENT_SECRET ||
      env.SCHWAB_REFRESH_TOKEN ||
      env.ROBINHOOD_ACCESS_TOKEN ||
      env.ANTHROPIC_API_KEY,
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The signing key. An explicit DAHCORP_SESSION_SECRET is strongly preferred;
 * falling back to a key derived from the passcode keeps a fresh deploy working
 * at the cost of invalidating sessions whenever the passcode changes.
 */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function signingKey(env: SessionEnvironment): Promise<HmacKey> {
  const material = env.sessionSecret ?? (env.passcode ? `derived:${env.passcode}` : null);
  if (!material) throw new Error('No session secret or passcode configured.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(material));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Length-independent comparison, so a mismatch leaks no timing information. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

interface SessionPayload {
  /** Issued at, epoch seconds. */
  iat: number;
  /** Expires at, epoch seconds. */
  exp: number;
}

export async function issueSessionCookie(env: SessionEnvironment, now = Date.now()): Promise<string> {
  const payload: SessionPayload = {
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + env.ttlMinutes * 60,
  };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await signingKey(env);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const token = `${body}.${base64url(new Uint8Array(signature))}`;
  const maxAge = env.ttlMinutes * 60;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export type SessionMode = 'authenticated' | 'public_demo';

export interface SessionState {
  authenticated: boolean;
  mode: SessionMode | null;
  /** Seconds until the session expires, when authenticated by cookie. */
  expiresInSeconds: number | null;
  /** True when no passcode is configured, so the app cannot be unlocked yet. */
  setupRequired: boolean;
  publicDemo: boolean;
}

export async function verifySession(req: Request, env = readSessionEnv(), now = Date.now()): Promise<SessionState> {
  const setupRequired = !env.passcode;

  if (setupRequired && env.publicDemo && !liveCredentialsPresent()) {
    // Explicitly opted-in demo mode: mock data only, no credentials present.
    return { authenticated: true, mode: 'public_demo', expiresInSeconds: null, setupRequired, publicDemo: true };
  }
  if (setupRequired) {
    return { authenticated: false, mode: null, expiresInSeconds: null, setupRequired, publicDemo: env.publicDemo };
  }

  const token = readCookie(req, COOKIE_NAME);
  if (!token || !token.includes('.')) {
    return { authenticated: false, mode: null, expiresInSeconds: null, setupRequired, publicDemo: false };
  }

  const [body, signature] = token.split('.');
  try {
    const key = await signingKey(env);
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature), encoder.encode(body));
    if (!valid) throw new Error('bad signature');
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionPayload;
    const secondsLeft = payload.exp - Math.floor(now / 1000);
    if (secondsLeft <= 0) throw new Error('expired');
    return {
      authenticated: true,
      mode: 'authenticated',
      expiresInSeconds: secondsLeft,
      setupRequired: false,
      publicDemo: false,
    };
  } catch {
    return { authenticated: false, mode: null, expiresInSeconds: null, setupRequired: false, publicDemo: false };
  }
}

export async function passcodeMatches(candidate: string, env = readSessionEnv()): Promise<boolean> {
  if (!env.passcode) return false;
  return constantTimeEqual(candidate, env.passcode);
}

/**
 * Guard for every data function. Returns a Response to send when the caller is
 * not permitted, or null when the request may proceed.
 */
export async function requireSession(req: Request): Promise<{ session: SessionState; response: Response | null }> {
  const session = await verifySession(req);
  if (session.authenticated) return { session, response: null };

  if (session.setupRequired) {
    return {
      session,
      response: fail(
        503,
        'SETUP_REQUIRED',
        'DAHCORP_ACCESS_PASSCODE is not configured. The dashboard stays locked until an access passcode is set in the Netlify environment.',
        { setupRequired: true },
      ),
    };
  }
  return { session, response: fail(401, 'UNAUTHENTICATED', 'Sign in to view this data.') };
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
