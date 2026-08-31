import type { ModelDataProvenance } from './provenance.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const DEFAULT_JOB_TTL_SECONDS = 15 * 60;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function signingKey(secretMaterial: string): Promise<HmacKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`treasury-agent-job:${secretMaterial}`));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export interface TreasuryAgentJob {
  responseId: string;
  question: string;
  capital: number;
  inputAsOf: string;
  /** SHA-256 of the exact provider runtime input string submitted to OpenAI. */
  modelInputFingerprint?: string;
  /** Safe, non-secret lineage/freshness envelope for the original model input. */
  modelDataProvenance?: ModelDataProvenance;
  iat: number;
  exp: number;
}

export function isOpenAIResponseId(value: unknown): value is string {
  return typeof value === 'string' && /^resp_[A-Za-z0-9_-]{6,200}$/.test(value);
}

function validFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validProvenance(value: unknown): value is ModelDataProvenance {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ModelDataProvenance>;
  return row.schemaVersion === 1
    && typeof row.generatedAt === 'string'
    && Boolean(row.preparation)
    && Boolean(row.portfolio)
    && Boolean(row.market)
    && Boolean(row.intelligence)
    && Array.isArray(row.constraints);
}

export async function issueAgentJobTokenWithSecret(
  input: Omit<TreasuryAgentJob, 'iat' | 'exp'>,
  secretMaterial: string,
  now = Date.now(),
  ttlSeconds = DEFAULT_JOB_TTL_SECONDS,
): Promise<string> {
  if (!secretMaterial) throw new Error('Treasury job signing material is required.');
  if (!isOpenAIResponseId(input.responseId)) throw new Error('Invalid OpenAI response id.');
  if (!input.question.trim() || input.question.length > 600) throw new Error('Invalid Treasury question.');
  if (!Number.isFinite(input.capital) || input.capital < 0) throw new Error('Invalid Treasury capital.');
  if (input.modelInputFingerprint != null && !validFingerprint(input.modelInputFingerprint)) throw new Error('Invalid Treasury model input fingerprint.');
  if (input.modelDataProvenance != null && !validProvenance(input.modelDataProvenance)) throw new Error('Invalid Treasury model provenance.');

  const issuedAt = Math.floor(now / 1000);
  const payload: TreasuryAgentJob = {
    ...input,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await signingKey(secretMaterial);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyAgentJobTokenWithSecret(
  token: string,
  secretMaterial: string,
  now = Date.now(),
): Promise<TreasuryAgentJob | null> {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra || !secretMaterial) return null;
  try {
    const key = await signingKey(secretMaterial);
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64url(body))) as Partial<TreasuryAgentJob>;
    const nowSeconds = Math.floor(now / 1000);
    if (!isOpenAIResponseId(payload.responseId)) return null;
    if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 600) return null;
    if (typeof payload.capital !== 'number' || !Number.isFinite(payload.capital) || payload.capital < 0) return null;
    if (typeof payload.inputAsOf !== 'string' || !payload.inputAsOf) return null;
    if (payload.modelInputFingerprint != null && !validFingerprint(payload.modelInputFingerprint)) return null;
    if (payload.modelDataProvenance != null && !validProvenance(payload.modelDataProvenance)) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= nowSeconds || payload.iat > nowSeconds + 60 || payload.exp <= payload.iat) return null;
    return payload as TreasuryAgentJob;
  } catch {
    return null;
  }
}
