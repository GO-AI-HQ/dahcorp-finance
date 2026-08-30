import { createPrivateKey, randomBytes, sign as signPayload, type KeyObject } from 'node:crypto';

export interface OpenBBEnvelope<T> {
  results?: T[];
  provider?: string | null;
  warnings?: unknown;
  extra?: unknown;
}

type RuntimeEnv = Record<string, string | undefined>;

function envValue(key: string, env?: RuntimeEnv): string | undefined {
  const explicit = env?.[key];
  if (explicit != null) return explicit;
  try {
    const netlify = (globalThis as typeof globalThis & {
      Netlify?: { env?: { get?: (name: string) => string | undefined } };
    }).Netlify;
    return netlify?.env?.get?.(key);
  } catch {
    return undefined;
  }
}

export class OpenBBGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OpenBBGatewayError';
  }
}

/**
 * Server-only authenticated client for the DAHCorp OpenBB Cloud Run gateway.
 * The Ed25519 private key remains in Netlify. Google stores only the public key.
 */
export class SignedOpenBBGatewayClient {
  private readonly baseUrl: string;
  private readonly signingKeyValue: string;
  private signingKey: KeyObject | null = null;

  constructor(env?: RuntimeEnv, private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = (envValue('OPENBB_GATEWAY_URL', env)?.trim() || '').replace(/\/$/, '');
    this.signingKeyValue = envValue('OPENBB_GATEWAY_SIGNING_KEY', env)?.trim() || '';
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.signingKeyValue);
  }

  private privateKey(): KeyObject {
    if (this.signingKey) return this.signingKey;
    try {
      this.signingKey = createPrivateKey({
        key: Buffer.from(this.signingKeyValue, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      return this.signingKey;
    } catch (cause) {
      throw new OpenBBGatewayError('OpenBB gateway signing key is invalid.', null, cause);
    }
  }

  private signedHeaders(path: string, query: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(18).toString('base64url');
    const canonical = ['GET', path, query, timestamp, nonce].join('\n');
    const signature = signPayload(null, Buffer.from(canonical, 'utf8'), this.privateKey()).toString('base64url');
    return {
      Accept: 'application/json',
      'X-DAHCORP-TIMESTAMP': timestamp,
      'X-DAHCORP-NONCE': nonce,
      'X-DAHCORP-SIGNATURE': signature,
    };
  }

  async get<T>(path: string, params: URLSearchParams = new URLSearchParams()): Promise<T> {
    if (!this.isConfigured()) throw new OpenBBGatewayError('OpenBB gateway is not configured.');
    const query = params.toString();
    const suffix = query ? `?${query}` : '';
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}${suffix}`, {
        headers: this.signedHeaders(path, query),
      });
    } catch (cause) {
      throw new OpenBBGatewayError('OpenBB gateway could not be reached.', null, cause);
    }
    if (!response.ok) {
      throw new OpenBBGatewayError(`OpenBB gateway returned HTTP ${response.status}.`, response.status);
    }
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new OpenBBGatewayError('OpenBB gateway returned invalid JSON.', response.status, cause);
    }
  }
}
