import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';

const TOKEN_KEY = 'broker_oauth_schwab';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface EncryptedTokenRecord {
  version: 1;
  iv: string;
  ciphertext: string;
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

async function tokenKey(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.SCHWAB_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY must be configured with at least 32 random characters.');
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptToken(value: string): Promise<EncryptedTokenRecord> {
  const key = await tokenKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value));
  return {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

async function decryptToken(record: EncryptedTokenRecord): Promise<string> {
  if (record.version !== 1 || !record.iv || !record.ciphertext) throw new Error('Unsupported token record.');
  const key = await tokenKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext),
  );
  return decoder.decode(plain);
}

/**
 * Load Schwab's refresh token without ever returning it to the browser.
 * SCHWAB_REFRESH_TOKEN remains a migration/bootstrap fallback; once OAuth is
 * completed in-app, the encrypted database copy is preferred.
 */
export async function loadSchwabRefreshToken(): Promise<string | null> {
  const db = getDb();
  if (db) {
    try {
      const rows = await db.select().from(schema.settings).where(eq(schema.settings.key, TOKEN_KEY)).limit(1);
      const record = rows[0]?.value as EncryptedTokenRecord | undefined;
      if (record?.ciphertext) return await decryptToken(record);
    } catch {
      // Do not log token/decryption details. A failed decrypt simply makes the
      // connection appear disconnected so the investor can authorize again.
      console.error('[dahcorp] Schwab OAuth token could not be read.');
    }
  }

  return process.env.SCHWAB_REFRESH_TOKEN?.trim() || null;
}

/** Persist the newest refresh token using AES-GCM. Token material is never logged. */
export async function saveSchwabRefreshToken(refreshToken: string): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('Netlify Database is required to persist the Schwab OAuth refresh token.');
  }
  const encrypted = await encryptToken(refreshToken);
  await db
    .insert(schema.settings)
    .values({ key: TOKEN_KEY, value: encrypted })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: encrypted, updatedAt: new Date() },
    });
}
