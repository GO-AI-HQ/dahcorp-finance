import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';

const OAUTH_KEY = 'broker_oauth_robinhood';
const PENDING_KEY = 'broker_oauth_robinhood_pending';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface EncryptedRecord {
  version: 1;
  iv: string;
  ciphertext: string;
}

export interface RobinhoodOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt: number;
}

export interface RobinhoodOAuthRecord {
  clientId: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  /** Exact redirect URI registered for this dynamic OAuth client. */
  redirectUri?: string;
  scope?: string;
  tokens?: RobinhoodOAuthTokens;
}

export interface RobinhoodPendingAuth {
  state: string;
  codeVerifier: string;
  clientId: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  redirectUri: string;
  scope?: string;
  createdAt: number;
}

function runtimeEnv(key: string): string | undefined {
  const netlify = (globalThis as typeof globalThis & { Netlify?: { env?: { get?: (name: string) => string | undefined } } }).Netlify;
  return netlify?.env?.get?.(key) ?? process.env[key];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey() {
  const secret = runtimeEnv('ROBINHOOD_TOKEN_ENCRYPTION_KEY')?.trim() || runtimeEnv('SCHWAB_TOKEN_ENCRYPTION_KEY')?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('Configure ROBINHOOD_TOKEN_ENCRYPTION_KEY (or the existing SCHWAB_TOKEN_ENCRYPTION_KEY) with at least 32 characters.');
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`robinhood:${secret}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(value: unknown): Promise<EncryptedRecord> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decrypt<T>(record: EncryptedRecord): Promise<T> {
  if (record.version !== 1 || !record.iv || !record.ciphertext) throw new Error('Unsupported encrypted Robinhood OAuth record.');
  const key = await encryptionKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext),
  );
  return JSON.parse(decoder.decode(plain)) as T;
}

async function load<T>(key: string): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
    const record = rows[0]?.value as EncryptedRecord | undefined;
    return record?.ciphertext ? await decrypt<T>(record) : null;
  } catch {
    console.error(`[dahcorp] Encrypted Robinhood OAuth record ${key} could not be read.`);
    return null;
  }
}

async function save(key: string, value: unknown): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Netlify Database is required for Robinhood OAuth.');
  const encrypted = await encrypt(value);
  await db
    .insert(schema.settings)
    .values({ key, value: encrypted })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: encrypted, updatedAt: new Date() } });
}

async function remove(key: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.delete(schema.settings).where(eq(schema.settings.key, key));
}

export function loadRobinhoodOAuth(): Promise<RobinhoodOAuthRecord | null> {
  return load<RobinhoodOAuthRecord>(OAUTH_KEY);
}

export function saveRobinhoodOAuth(value: RobinhoodOAuthRecord): Promise<void> {
  return save(OAUTH_KEY, value);
}

export function loadRobinhoodPendingAuth(): Promise<RobinhoodPendingAuth | null> {
  return load<RobinhoodPendingAuth>(PENDING_KEY);
}

export function saveRobinhoodPendingAuth(value: RobinhoodPendingAuth): Promise<void> {
  return save(PENDING_KEY, value);
}

export function clearRobinhoodPendingAuth(): Promise<void> {
  return remove(PENDING_KEY);
}
