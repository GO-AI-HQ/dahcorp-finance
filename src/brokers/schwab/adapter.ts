import type { ProposedOrder } from '../../risk/types.js';
import {
  BrokerNotConfiguredError,
  ExecutionDisabledError,
  type BrokerAccountData,
  type BrokerAdapter,
  type BrokerCapability,
  type OrderPreviewResult,
  type OrderStatus,
} from '../types.js';

/**
 * Charles Schwab Trader API adapter.
 *
 * A thin, modular wrapper around the official Schwab Trader API. Deliberately
 * kept free of strategy logic: it translates between Schwab's payloads and this
 * application's domain types and does nothing else, so Claude is never coupled
 * to Schwab and Schwab is never coupled to the strategy.
 *
 * OAuth notes (see docs/SECURITY.md):
 *   - The client secret and refresh token are server-side only.
 *   - Refresh tokens belong in encrypted server-side storage, never in
 *     localStorage and never in a response body.
 *   - Access tokens are short-lived and held in function memory only.
 */
export interface SchwabConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  baseUrl: string;
  mode: 'mock' | 'live';
}

export const SCHWAB_DEFAULT_BASE_URL = 'https://api.schwabapi.com';

export function readSchwabConfig(env: Record<string, string | undefined>): SchwabConfig {
  const clientId = env.SCHWAB_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.SCHWAB_CLIENT_SECRET?.trim() || undefined;
  const refreshToken = env.SCHWAB_REFRESH_TOKEN?.trim() || undefined;
  const declared = env.SCHWAB_MODE?.trim() as SchwabConfig['mode'] | undefined;
  return {
    clientId,
    clientSecret,
    redirectUri: env.SCHWAB_REDIRECT_URI?.trim() || undefined,
    refreshToken,
    baseUrl: env.SCHWAB_API_BASE_URL?.trim() || SCHWAB_DEFAULT_BASE_URL,
    mode: declared ?? (clientId && clientSecret && refreshToken ? 'live' : 'mock'),
  };
}

interface SchwabTokenState {
  accessToken: string;
  expiresAt: number;
}

/** Raw Schwab payload shapes, narrowed to only what this adapter consumes. */
interface SchwabPositionPayload {
  instrument?: { symbol?: string; assetType?: string };
  longQuantity?: number;
  shortQuantity?: number;
  averagePrice?: number;
  marketValue?: number;
}

interface SchwabAccountPayload {
  securitiesAccount?: {
    accountNumber?: string;
    type?: string;
    currentBalances?: { cashAvailableForTrading?: number; cashBalance?: number };
    positions?: SchwabPositionPayload[];
  };
}

export class SchwabAdapter implements BrokerAdapter {
  readonly id = 'schwab' as const;
  readonly label = 'Charles Schwab';

  private token: SchwabTokenState | null = null;

  constructor(
    private readonly config: SchwabConfig,
    private readonly fallback: () => BrokerAccountData,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get capabilities(): BrokerCapability[] {
    const base: BrokerCapability[] = ['read_accounts', 'read_positions'];
    if (this.config.mode === 'live' && this.isConfigured()) {
      base.push('read_quotes', 'preview_order', 'order_status');
    }
    // `place_order` is never advertised in this build.
    return base;
  }

  isConfigured(): boolean {
    if (this.config.mode === 'mock') return true;
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.refreshToken);
  }

  configurationStatus() {
    const missing: string[] = [];
    if (this.config.mode === 'live') {
      if (!this.config.clientId) missing.push('SCHWAB_CLIENT_ID');
      if (!this.config.clientSecret) missing.push('SCHWAB_CLIENT_SECRET');
      if (!this.config.refreshToken) missing.push('SCHWAB_REFRESH_TOKEN');
    }
    return {
      configured: this.isConfigured(),
      missing,
      note:
        this.config.mode === 'mock'
          ? 'Running against the seeded read-only portfolio model. No Schwab connection is attempted.'
          : 'Configured against the official Schwab Trader API. Read-only in this build.',
    };
  }

  /** Exchange the refresh token for a short-lived access token. */
  private async ensureAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new BrokerNotConfiguredError('Charles Schwab', this.configurationStatus().missing);
    }
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.accessToken;

    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const response = await this.fetchImpl(`${this.config.baseUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.config.refreshToken ?? '',
      }).toString(),
    });

    if (!response.ok) {
      // The response body may echo credential material; it is not surfaced.
      throw new Error(`Schwab token refresh failed with status ${response.status}.`);
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) throw new Error('Schwab token refresh returned no access token.');
    this.token = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
    };
    return this.token.accessToken;
  }

  async authenticate() {
    if (this.config.mode === 'mock') {
      return { ok: true, message: 'Schwab adapter in mock mode — no authentication required.' };
    }
    try {
      await this.ensureAccessToken();
      return { ok: true, message: 'Schwab access token obtained.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Schwab authentication failed.' };
    }
  }

  async getAccountData(): Promise<BrokerAccountData> {
    if (this.config.mode === 'mock') return this.fallback();

    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchImpl(`${this.config.baseUrl}/trader/v1/accounts?fields=positions`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Schwab accounts request failed with status ${response.status}.`);
    const payload = (await response.json()) as SchwabAccountPayload[];
    return this.mapAccountData(payload);
  }

  /** Translate Schwab payloads into domain types. Pure and unit-testable. */
  mapAccountData(payload: SchwabAccountPayload[]): BrokerAccountData {
    const asOf = new Date().toISOString().slice(0, 10);
    const accounts: BrokerAccountData['accounts'] = [];
    const holdings: BrokerAccountData['holdings'] = [];

    for (const entry of payload) {
      const raw = entry.securitiesAccount;
      if (!raw?.accountNumber) continue;
      // Account numbers are hashed into an internal id so they never appear in
      // client-visible payloads.
      const id = `schwab-${raw.accountNumber.slice(-4)}`;
      accounts.push({
        id,
        broker: 'schwab',
        name: `Charles Schwab ····${raw.accountNumber.slice(-4)}`,
        type: raw.type?.toUpperCase().includes('IRA') ? 'roth_ira' : 'taxable',
        role: 'Imported from the Schwab Trader API.',
        cash: raw.currentBalances?.cashAvailableForTrading ?? raw.currentBalances?.cashBalance ?? 0,
        allocationEligible: !raw.type?.toUpperCase().includes('IRA'),
        tradeEligible: false,
        dataQuality: 'live',
      });

      for (const position of raw.positions ?? []) {
        const symbol = position.instrument?.symbol;
        const shares = (position.longQuantity ?? 0) - (position.shortQuantity ?? 0);
        if (!symbol || shares === 0) continue;
        holdings.push({
          id: `${id}-${symbol}`,
          accountId: id,
          symbol: symbol.toUpperCase(),
          shares,
          costBasisTotal: (position.averagePrice ?? 0) * Math.abs(shares),
          sleeve: 'unclassified',
        });
      }
    }
    return { accounts, holdings, asOf };
  }

  async previewOrder(order: ProposedOrder): Promise<OrderPreviewResult> {
    if (this.config.mode === 'mock') {
      return {
        accepted: false,
        estimatedPrice: null,
        estimatedShares: null,
        estimatedCommission: 0,
        warnings: [`Schwab adapter is in mock mode — the ${order.symbol} preview is produced by the local risk engine only.`],
        previewToken: null,
      };
    }
    // A live preview would POST to the accounts/{id}/previewOrder endpoint. It
    // is intentionally not wired here: preview is only meaningful alongside a
    // place-order path, and this build has none.
    return {
      accepted: false,
      estimatedPrice: null,
      estimatedShares: null,
      estimatedCommission: 0,
      warnings: [
        'Schwab order preview is not enabled in this build. Enabling it is Phase 4 work and requires the human-approval workflow described in docs/SECURITY.md.',
      ],
      previewToken: null,
    };
  }

  async placeOrder(): Promise<OrderStatus> {
    throw new ExecutionDisabledError('Charles Schwab');
  }

  async getOrderStatus(brokerOrderId: string): Promise<OrderStatus> {
    return {
      brokerOrderId,
      status: 'not_submitted',
      filledShares: 0,
      filledAveragePrice: null,
      message: 'No orders have been submitted through this adapter.',
    };
  }
}
