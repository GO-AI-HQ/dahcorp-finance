import type { RobinhoodMcpGateway, RobinhoodMcpTool } from '../../src/brokers/robinhood/adapter.js';
import {
  loadRobinhoodOAuth,
  saveRobinhoodOAuth,
  type RobinhoodOAuthRecord,
  type RobinhoodOAuthTokens,
} from './robinhoodOAuth.mts';

export const ROBINHOOD_MCP_RESOURCE = 'https://agent.robinhood.com/mcp/trading';
const CLIENT_NAME = 'DAHCorp Finance';
const CLIENT_VERSION = '0.1.0';
const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26'] as const;

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

export interface RobinhoodOAuthDiscovery {
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scope?: string;
}

interface RpcEnvelope {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

function runtimeEnv(key: string): string | undefined {
  const netlify = (globalThis as typeof globalThis & { Netlify?: { env?: { get?: (name: string) => string | undefined } } }).Netlify;
  return netlify?.env?.get?.(key) ?? process.env[key];
}

export function robinhoodResource(): string {
  return runtimeEnv('ROBINHOOD_MCP_ENDPOINT')?.trim() || ROBINHOOD_MCP_RESOURCE;
}

export function robinhoodCallbackUrl(): string | null {
  return runtimeEnv('ROBINHOOD_CALLBACK_URL')?.trim() || null;
}

function metadataUrl(issuer: string, kind: 'oauth-protected-resource' | 'oauth-authorization-server'): string {
  const url = new URL(issuer);
  const suffix = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}/.well-known/${kind}${suffix}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`OAuth metadata request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function discoverRobinhoodOAuth(resource = robinhoodResource()): Promise<RobinhoodOAuthDiscovery> {
  const protectedMetadataUrl = metadataUrl(resource, 'oauth-protected-resource');
  let protectedMetadata: ProtectedResourceMetadata = {};
  try {
    protectedMetadata = await fetchJson<ProtectedResourceMetadata>(protectedMetadataUrl);
  } catch {
    // Robinhood also exposes authorization-server metadata on the resource path;
    // failure here is not fatal as long as that metadata can be discovered.
  }

  const issuer = protectedMetadata.authorization_servers?.[0] || resource;
  let authorizationMetadata: AuthorizationServerMetadata;
  try {
    authorizationMetadata = await fetchJson<AuthorizationServerMetadata>(metadataUrl(issuer, 'oauth-authorization-server'));
  } catch {
    // Robinhood's current RFC 8414 document uses the path-inserted resource form.
    authorizationMetadata = await fetchJson<AuthorizationServerMetadata>(metadataUrl(resource, 'oauth-authorization-server'));
  }

  if (!authorizationMetadata.authorization_endpoint || !authorizationMetadata.token_endpoint) {
    throw new Error('Robinhood OAuth discovery returned incomplete authorization metadata.');
  }
  if (
    authorizationMetadata.code_challenge_methods_supported?.length &&
    !authorizationMetadata.code_challenge_methods_supported.includes('S256')
  ) {
    throw new Error('Robinhood OAuth does not advertise the required PKCE S256 method.');
  }

  const supportedScopes = authorizationMetadata.scopes_supported ?? protectedMetadata.scopes_supported ?? [];
  const scope = supportedScopes.includes('internal') ? 'internal' : supportedScopes[0];
  return {
    resource: protectedMetadata.resource || resource,
    authorizationEndpoint: authorizationMetadata.authorization_endpoint,
    tokenEndpoint: authorizationMetadata.token_endpoint,
    registrationEndpoint: authorizationMetadata.registration_endpoint,
    scope,
  };
}

export async function ensureRobinhoodClient(
  discovery: RobinhoodOAuthDiscovery,
  redirectUri: string,
): Promise<RobinhoodOAuthRecord> {
  const existing = await loadRobinhoodOAuth();
  if (
    existing?.clientId &&
    existing.resource === discovery.resource &&
    existing.authorizationEndpoint === discovery.authorizationEndpoint &&
    existing.tokenEndpoint === discovery.tokenEndpoint
  ) {
    return { ...existing, scope: discovery.scope ?? existing.scope, registrationEndpoint: discovery.registrationEndpoint };
  }

  if (!discovery.registrationEndpoint) {
    throw new Error('Robinhood OAuth metadata does not advertise dynamic client registration.');
  }
  const response = await fetch(discovery.registrationEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) throw new Error(`Robinhood dynamic client registration failed (${response.status}).`);
  const payload = (await response.json()) as { client_id?: string };
  if (!payload.client_id) throw new Error('Robinhood dynamic client registration returned no client_id.');

  const record: RobinhoodOAuthRecord = {
    clientId: payload.client_id,
    resource: discovery.resource,
    authorizationEndpoint: discovery.authorizationEndpoint,
    tokenEndpoint: discovery.tokenEndpoint,
    registrationEndpoint: discovery.registrationEndpoint,
    scope: discovery.scope,
  };
  await saveRobinhoodOAuth(record);
  return record;
}

function tokenSet(payload: Record<string, unknown>, previousRefresh?: string): RobinhoodOAuthTokens {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!accessToken) throw new Error('Robinhood token response returned no access token.');
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in ?? 3600);
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : previousRefresh,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    expiresAt: Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  };
}

export async function exchangeRobinhoodAuthorizationCode(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  tokenEndpoint: string;
  resource: string;
  scope?: string;
}): Promise<RobinhoodOAuthTokens> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
    resource: args.resource,
  });
  if (args.scope) form.set('scope', args.scope);
  const response = await fetch(args.tokenEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`Robinhood authorization-code exchange failed (${response.status}).`);
  return tokenSet((await response.json()) as Record<string, unknown>);
}

async function refreshRobinhoodTokens(record: RobinhoodOAuthRecord): Promise<RobinhoodOAuthRecord> {
  const refreshToken = record.tokens?.refreshToken;
  if (!refreshToken) throw new Error('Robinhood refresh token is unavailable; reconnect Robinhood.');
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: record.clientId,
    resource: record.resource,
  });
  if (record.scope) form.set('scope', record.scope);
  const response = await fetch(record.tokenEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`Robinhood token refresh failed (${response.status}).`);
  const next = { ...record, tokens: tokenSet((await response.json()) as Record<string, unknown>, refreshToken) };
  await saveRobinhoodOAuth(next);
  return next;
}

async function usableOAuthRecord(forceRefresh = false): Promise<RobinhoodOAuthRecord | null> {
  let record = await loadRobinhoodOAuth();
  if (!record?.tokens?.accessToken) return null;
  if (forceRefresh || record.tokens.expiresAt <= Date.now() + 5 * 60_000) record = await refreshRobinhoodTokens(record);
  return record;
}

function parseSse(text: string, expectedId?: number): RpcEnvelope | null {
  const messages: RpcEnvelope[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data) continue;
    try { messages.push(JSON.parse(data) as RpcEnvelope); } catch { /* Ignore keepalive/non-JSON SSE frames. */ }
  }
  if (expectedId != null) return messages.find((message) => Number(message.id) === expectedId) ?? messages.at(-1) ?? null;
  return messages.at(-1) ?? null;
}

async function parseRpcResponse(response: Response, expectedId?: number): Promise<RpcEnvelope | null> {
  const text = await response.text();
  if (!text) return null;
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) return parseSse(text, expectedId);
  return JSON.parse(text) as RpcEnvelope;
}

class RobinhoodMcpHttpGateway implements RobinhoodMcpGateway {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private nextId = 1;
  private tools: RobinhoodMcpTool[] | null = null;

  constructor(private oauth: RobinhoodOAuthRecord) {}

  private async send(body: Record<string, unknown>, expectedId?: number, retryAuth = true): Promise<{ response: Response; envelope: RpcEnvelope | null }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.oauth.tokens!.accessToken}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
    let response = await fetch(this.oauth.resource, { method: 'POST', headers, body: JSON.stringify(body) });
    if (response.status === 401 && retryAuth) {
      const refreshed = await usableOAuthRecord(true);
      const refreshedAccessToken = refreshed?.tokens?.accessToken;
      if (!refreshed || !refreshedAccessToken) throw new Error('Robinhood OAuth refresh failed.');
      this.oauth = refreshed;
      headers.Authorization = `Bearer ${refreshedAccessToken}`;
      response = await fetch(this.oauth.resource, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    if (!response.ok) throw new Error(`Robinhood MCP request failed (${response.status}).`);
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    const envelope = await parseRpcResponse(response, expectedId);
    if (envelope?.error) throw new Error(`Robinhood MCP error ${envelope.error.code ?? ''}: ${envelope.error.message ?? 'request failed'}.`);
    return { response, envelope };
  }

  private async initialize(): Promise<void> {
    if (this.protocolVersion) return;
    let lastError: unknown = null;
    for (const version of MCP_PROTOCOLS) {
      const id = this.nextId++;
      try {
        const { envelope } = await this.send({
          jsonrpc: '2.0',
          id,
          method: 'initialize',
          params: { protocolVersion: version, capabilities: {}, clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION } },
        }, id);
        const result = envelope?.result as { protocolVersion?: string } | undefined;
        this.protocolVersion = result?.protocolVersion || version;
        await this.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        return;
      } catch (error) {
        lastError = error;
        this.sessionId = null;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Robinhood MCP initialization failed.');
  }

  async listTools(): Promise<RobinhoodMcpTool[]> {
    if (this.tools) return this.tools;
    await this.initialize();
    const id = this.nextId++;
    const { envelope } = await this.send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }, id);
    const result = envelope?.result as { tools?: RobinhoodMcpTool[] } | undefined;
    this.tools = Array.isArray(result?.tools) ? result.tools : [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.initialize();
    const id = this.nextId++;
    const { envelope } = await this.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, id);
    const result = envelope?.result as { isError?: boolean; structuredContent?: unknown; content?: { type?: string; text?: string; json?: unknown }[] } | undefined;
    if (result?.isError) {
      const message = result.content?.find((item) => typeof item.text === 'string')?.text;
      throw new Error(`Robinhood ${name} rejected the request${message ? `: ${message.slice(0, 240)}` : ''}.`);
    }
    if (result?.structuredContent != null) return result.structuredContent;
    for (const item of result?.content ?? []) {
      if (item.json != null) return item.json;
      if (typeof item.text === 'string') {
        try { return JSON.parse(item.text) as unknown; } catch { /* Continue to raw text fallback. */ }
      }
    }
    return result ?? {};
  }
}

export async function createRobinhoodGateway(): Promise<RobinhoodMcpGateway | null> {
  const record = await usableOAuthRecord();
  return record?.tokens?.accessToken ? new RobinhoodMcpHttpGateway(record) : null;
}

export async function robinhoodConnected(): Promise<boolean> {
  try { return Boolean(await createRobinhoodGateway()); } catch { return false; }
}
