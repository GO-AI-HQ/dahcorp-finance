const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_JOB_TTL_SECONDS = 15 * 60;

function envValue(key: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (env) return env[key];
  try {
    const value = Netlify.env.get(key);
    if (value != null) return value;
  } catch {
    // Local/unit-test runtimes may not expose the Netlify global.
  }
  return process.env[key];
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function signingKey(env?: NodeJS.ProcessEnv): Promise<HmacKey> {
  const sessionSecret = envValue('DAHCORP_SESSION_SECRET', env)?.trim();
  const passcode = envValue('DAHCORP_ACCESS_PASSCODE', env)?.trim();
  const material = sessionSecret || (passcode ? `derived:${passcode}` : null);
  if (!material) throw new Error('No DAHCorp signing material is configured.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`treasury-agent-job:${material}`));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export interface TreasuryAgentJob {
  responseId: string;
  question: string;
  capital: number;
  inputAsOf: string;
  iat: number;
  exp: number;
}

export function isOpenAIResponseId(value: unknown): value is string {
  return typeof value === 'string' && /^resp_[A-Za-z0-9_-]{6,200}$/.test(value);
}

export async function issueAgentJobToken(
  input: Omit<TreasuryAgentJob, 'iat' | 'exp'>,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): Promise<string> {
  if (!isOpenAIResponseId(input.responseId)) throw new Error('Invalid OpenAI response id.');
  if (!input.question.trim() || input.question.length > 600) throw new Error('Invalid Treasury question.');
  if (!Number.isFinite(input.capital) || input.capital < 0) throw new Error('Invalid Treasury capital.');

  const issuedAt = Math.floor(now / 1000);
  const payload: TreasuryAgentJob = {
    ...input,
    iat: issuedAt,
    exp: issuedAt + DEFAULT_JOB_TTL_SECONDS,
  };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await signingKey(env);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyAgentJobToken(
  token: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): Promise<TreasuryAgentJob | null> {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  try {
    const key = await signingKey(env);
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64url(body))) as Partial<TreasuryAgentJob>;
    const nowSeconds = Math.floor(now / 1000);
    if (!isOpenAIResponseId(payload.responseId)) return null;
    if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 600) return null;
    if (typeof payload.capital !== 'number' || !Number.isFinite(payload.capital) || payload.capital < 0) return null;
    if (typeof payload.inputAsOf !== 'string' || !payload.inputAsOf) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= nowSeconds || payload.iat > nowSeconds + 60 || payload.exp <= payload.iat) return null;
    return payload as TreasuryAgentJob;
  } catch {
    return null;
  }
}
