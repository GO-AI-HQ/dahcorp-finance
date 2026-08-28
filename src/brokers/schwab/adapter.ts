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
 * Strategy logic never lives here. The adapter only handles OAuth, Schwab
 * account identifiers, payload translation, market lookups and broker requests.
 * The execution surface is intentionally narrower than the brokerage account:
 * this build can BUY YMAG only, in whole-share market orders, and only when the
 * explicit deployment flag is enabled.
 */
export interface SchwabConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  baseUrl: string;
  mode: 'mock' | 'live';
  executionEnabled: boolean;
}

export interface SchwabTokenStore {
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken?(refreshToken: string): Promise<void>;
}

export interface SchwabQuoteSnapshot {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  asOf: string;
}

interface SchwabAccountNumberPayload {
  accountNumber?: string;
  hashValue?: string;
}

export const SCHWAB_DEFAULT_BASE_URL = 'https://api.schwabapi.com';
export const SCHWAB_EXECUTION_SYMBOL = 'YMAG';

export function schwabExecutionEnabled(env: Record<string, string | undefined>): boolean {
  return (env.SCHWAB_EXECUTION_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function readSchwabConfig(env: Record<string, string | undefined>): SchwabConfig {
  const clientId = env.SCHWAB_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.SCHWAB_CLIENT_SECRET?.trim() || undefined;
  const refreshToken = env.SCHWAB_REFRESH_TOKEN?.trim() || undefined;
  const declared = env.SCHWAB_MODE?.trim().toLowerCase() as SchwabConfig['mode'] | undefined;
  return {
    clientId,
    clientSecret,
    redirectUri: env.SCHWAB_CALLBACK_URL?.trim() || env.SCHWAB_REDIRECT_URI?.trim() || undefined,
    refreshToken,
    baseUrl: env.SCHWAB_API_BASE_URL?.trim() || SCHWAB_DEFAULT_BASE_URL,
    mode: declared === 'mock' || declared === 'live' ? declared : clientId && clientSecret ? 'live' : 'mock',
    executionEnabled: schwabExecutionEnabled(env),
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

interface SchwabQuotePayload {
  symbol?: string;
  quote?: {
    lastPrice?: number;
    mark?: number;
    bidPrice?: number;
    askPrice?: number;
    quoteTime?: number;
    tradeTime?: number;
  };
  regular?: { regularMarketLastPrice?: number; regularMarketTradeTime?: number };
}

function wholeShareQuantity(order: ProposedOrder): number {
  const quantity = order.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('Schwab live execution currently requires a positive whole-share quantity.');
  }
  return quantity;
}

function buildEquityMarketBuy(symbol: string, quantity: number) {
  return {
    session: 'NORMAL',
    duration: 'DAY',
    orderType: 'MARKET',
    orderStrategyType: 'SINGLE',
    orderLegCollection: [
      {
        instruction: 'BUY',
        quantity,
        instrument: { symbol, assetType: 'EQUITY' },
      },
    ],
  };
}

export class SchwabAdapter implements BrokerAdapter {
  readonly id = 'schwab' as const;
  readonly label = 'Charles Schwab';

  private token: SchwabTokenState | null = null;
  private accountNumbers: SchwabAccountNumberPayload[] | null = null;

  constructor(
    private readonly config: SchwabConfig,
    private readonly fallback: () => BrokerAccountData,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly tokenStore?: SchwabTokenStore,
  ) {}

  get capabilities(): BrokerCapability[] {
    const base: BrokerCapability[] = ['read_accounts', 'read_positions'];
    if (this.config.mode === 'live' && this.isConfigured()) {
      base.push('read_quotes', 'preview_order', 'order_status');
      if (this.config.executionEnabled) base.push('place_order');
    }
    return base;
  }

  isConfigured(): boolean {
    if (this.config.mode === 'mock') return true;
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  configurationStatus() {
    const missing: string[] = [];
    if (this.config.mode === 'live') {
      if (!this.config.clientId) missing.push('SCHWAB_CLIENT_ID');
      if (!this.config.clientSecret) missing.push('SCHWAB_CLIENT_SECRET');
    }
    return {
      configured: this.isConfigured(),
      missing,
      note:
        this.config.mode === 'mock'
          ? 'Running against the seeded portfolio model. No Schwab connection is attempted.'
          : this.config.executionEnabled
            ? 'Configured for Schwab production data and human-approved YMAG-only execution.'
            : 'Configured for Schwab production data. Live order execution remains deployment-disabled.',
    };
  }

  private async currentRefreshToken(): Promise<string | null> {
    if (this.tokenStore) {
      const stored = await this.tokenStore.loadRefreshToken();
      if (stored) return stored;
    }
    return this.config.refreshToken ?? null;
  }

  /** Exchange the refresh token for a short-lived access token. */
  private async ensureAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new BrokerNotConfiguredError('Charles Schwab', this.configurationStatus().missing);
    }
    if (this.config.mode === 'mock') throw new Error('Mock Schwab adapter has no access token.');
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.accessToken;

    const refreshToken = await this.currentRefreshToken();
    if (!refreshToken) throw new BrokerNotConfiguredError('Charles Schwab', ['Schwab OAuth authorization']);

    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const response = await this.fetchImpl(`${this.config.baseUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });

    if (!response.ok) {
      // The response body can contain sensitive provider detail; never surface it.
      throw new Error(`Schwab token refresh failed with status ${response.status}.`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!payload.access_token) throw new Error('Schwab token refresh returned no access token.');
    if (payload.refresh_token && payload.refresh_token !== refreshToken && this.tokenStore?.saveRefreshToken) {
      await this.tokenStore.saveRefreshToken(payload.refresh_token);
    }
    this.token = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
    };
    return this.token.accessToken;
  }

  /** Used by the OAuth/resource layer; never returned to browser code. */
  async accessToken(): Promise<string> {
    return this.ensureAccessToken();
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

  private async getAccountNumbers(): Promise<SchwabAccountNumberPayload[]> {
    if (this.accountNumbers) return this.accountNumbers;
    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchImpl(`${this.config.baseUrl}/trader/v1/accounts/accountNumbers`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Schwab account-number request failed with status ${response.status}.`);
    const payload = (await response.json()) as SchwabAccountNumberPayload[];
    this.accountNumbers = payload.filter((item) => item.accountNumber && item.hashValue);
    return this.accountNumbers;
  }

  private async resolveAccountHash(internalAccountId: string): Promise<string> {
    const suffix = internalAccountId.startsWith('schwab-') ? internalAccountId.slice('schwab-'.length) : '';
    if (!/^\d{4}$/.test(suffix)) throw new Error('Invalid Schwab account identifier.');
    const matches = (await this.getAccountNumbers()).filter((item) => item.accountNumber?.endsWith(suffix));
    if (matches.length !== 1 || !matches[0]?.hashValue) {
      throw new Error('Could not uniquely resolve the Schwab account to its encrypted API identifier.');
    }
    return matches[0].hashValue;
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
      const id = `schwab-${raw.accountNumber.slice(-4)}`;
      const retirement = raw.type?.toUpperCase().includes('IRA') ?? false;
      accounts.push({
        id,
        broker: 'schwab',
        name: `Charles Schwab ····${raw.accountNumber.slice(-4)}`,
        type: retirement ? 'roth_ira' : 'taxable',
        role: 'Imported from the Schwab Trader API.',
        cash: raw.currentBalances?.cashAvailableForTrading ?? raw.currentBalances?.cashBalance ?? 0,
        allocationEligible: !retirement,
        tradeEligible: !retirement && this.config.executionEnabled,
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
          sleeve: symbol.toUpperCase() === 'YMAG' ? 'income_engine' : 'unclassified',
          verification: 'CONFIRMED',
        });
      }
    }
    return { accounts, holdings, asOf };
  }

  /** Fresh Schwab market quote used only for the final trade preview/execution gate. */
  async getQuote(symbol: string): Promise<SchwabQuoteSnapshot> {
    if (this.config.mode !== 'live') throw new Error('Live Schwab market data is not configured.');
    const normalized = symbol.toUpperCase().trim();
    const accessToken = await this.ensureAccessToken();
    const params = new URLSearchParams({ symbols: normalized, fields: 'quote,regular' });
    const response = await this.fetchImpl(`${this.config.baseUrl}/marketdata/v1/quotes?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Schwab quote request failed with status ${response.status}.`);
    const payload = (await response.json()) as Record<string, SchwabQuotePayload>;
    const item = payload[normalized];
    const price = item?.quote?.mark ?? item?.quote?.lastPrice ?? item?.regular?.regularMarketLastPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw new Error(`Schwab returned no usable ${normalized} price.`);
    }
    const time = item?.quote?.tradeTime ?? item?.quote?.quoteTime ?? item?.regular?.regularMarketTradeTime;
    return {
      symbol: normalized,
      price,
      bid: typeof item?.quote?.bidPrice === 'number' ? item.quote.bidPrice : null,
      ask: typeof item?.quote?.askPrice === 'number' ? item.quote.askPrice : null,
      asOf: typeof time === 'number' ? new Date(time).toISOString() : new Date().toISOString(),
    };
  }

  async previewOrder(order: ProposedOrder): Promise<OrderPreviewResult> {
    if (this.config.mode === 'mock') {
      return {
        accepted: false,
        estimatedPrice: null,
        estimatedShares: null,
        estimatedCommission: 0,
        warnings: ['Schwab adapter is in mock mode; no broker preview was requested.'],
        previewToken: null,
      };
    }
    if (!this.config.executionEnabled) throw new ExecutionDisabledError('Charles Schwab');
    if (order.symbol.toUpperCase() !== SCHWAB_EXECUTION_SYMBOL || order.side !== 'buy' || order.orderType !== 'market') {
      throw new Error('Live Schwab execution is restricted to BUY YMAG market orders.');
    }
    const quantity = wholeShareQuantity(order);
    const hash = await this.resolveAccountHash(order.accountId);
    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchImpl(`${this.config.baseUrl}/trader/v1/accounts/${encodeURIComponent(hash)}/previewOrder`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEquityMarketBuy(SCHWAB_EXECUTION_SYMBOL, quantity)),
    });
    if (!response.ok) throw new Error(`Schwab order preview failed with status ${response.status}.`);
    const quote = await this.getQuote(SCHWAB_EXECUTION_SYMBOL);
    return {
      accepted: true,
      estimatedPrice: quote.price,
      estimatedShares: quantity,
      estimatedCommission: 0,
      warnings: [],
      previewToken: null,
    };
  }

  async placeOrder(order: ProposedOrder): Promise<OrderStatus> {
    if (!this.config.executionEnabled || this.config.mode !== 'live') throw new ExecutionDisabledError('Charles Schwab');
    if (order.symbol.toUpperCase() !== SCHWAB_EXECUTION_SYMBOL || order.side !== 'buy' || order.orderType !== 'market') {
      throw new Error('Live Schwab execution is restricted to BUY YMAG market orders.');
    }
    const quantity = wholeShareQuantity(order);
    const hash = await this.resolveAccountHash(order.accountId);
    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchImpl(`${this.config.baseUrl}/trader/v1/accounts/${encodeURIComponent(hash)}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEquityMarketBuy(SCHWAB_EXECUTION_SYMBOL, quantity)),
    });
    if (response.status !== 201) throw new Error(`Schwab order placement failed with status ${response.status}.`);
    const location = response.headers.get('location') ?? '';
    const brokerOrderId = location.split('/').filter(Boolean).pop() ?? null;
    return {
      brokerOrderId,
      status: 'pending',
      filledShares: 0,
      filledAveragePrice: null,
      message: `Schwab accepted the YMAG buy order${brokerOrderId ? ` (${brokerOrderId})` : ''}.`,
    };
  }

  async getOrderStatus(brokerOrderId: string): Promise<OrderStatus> {
    return {
      brokerOrderId,
      status: 'pending',
      filledShares: 0,
      filledAveragePrice: null,
      message: 'Order submitted. Refresh account/order history to confirm the broker-reported final state.',
    };
  }
}
