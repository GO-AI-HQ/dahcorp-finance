import type { Account, Holding } from '../../core/types.js';
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
 * Robinhood adapter.
 *
 * Robinhood does not publish a general-purpose retail trading API. The intended
 * integration path is Robinhood's official agentic/MCP surface once it is
 * available to this account, which is why this adapter is written as a thin
 * capability-gated shell rather than a scraper or an unofficial client.
 *
 * Until then it operates in one of two modes:
 *   - `mock`      — the seeded read-only portfolio model (default).
 *   - `manual`    — positions maintained by the user in the app database.
 *
 * No credentials are ever read in browser code. `ROBINHOOD_*` variables are
 * server-side only and are never returned in an API response.
 */
export interface RobinhoodConfig {
  /** Set when an official agentic/MCP endpoint has been provisioned. */
  mcpEndpoint?: string;
  /** Server-side only. Never logged, never returned to the client. */
  accessToken?: string;
  mode: 'mock' | 'manual' | 'live';
}

export function readRobinhoodConfig(env: Record<string, string | undefined>): RobinhoodConfig {
  const mcpEndpoint = env.ROBINHOOD_MCP_ENDPOINT?.trim() || undefined;
  const accessToken = env.ROBINHOOD_ACCESS_TOKEN?.trim() || undefined;
  const declared = env.ROBINHOOD_MODE?.trim() as RobinhoodConfig['mode'] | undefined;
  const mode: RobinhoodConfig['mode'] = declared ?? (mcpEndpoint && accessToken ? 'live' : 'mock');
  return { mcpEndpoint, accessToken, mode };
}

export class RobinhoodAdapter implements BrokerAdapter {
  readonly id = 'robinhood' as const;
  readonly label = 'Robinhood';

  constructor(
    private readonly config: RobinhoodConfig,
    /** Supplied by the portfolio service so the adapter never reads fixtures itself. */
    private readonly fallback: () => BrokerAccountData,
  ) {}

  get capabilities(): BrokerCapability[] {
    // Read-only in every mode this build supports. Execution capabilities are
    // deliberately absent rather than present-and-disabled, so nothing
    // downstream can discover a code path to them.
    return ['read_accounts', 'read_positions'];
  }

  isConfigured(): boolean {
    return this.config.mode !== 'live' || Boolean(this.config.mcpEndpoint && this.config.accessToken);
  }

  configurationStatus() {
    const missing: string[] = [];
    if (this.config.mode === 'live') {
      if (!this.config.mcpEndpoint) missing.push('ROBINHOOD_MCP_ENDPOINT');
      if (!this.config.accessToken) missing.push('ROBINHOOD_ACCESS_TOKEN');
    }
    return {
      configured: this.isConfigured(),
      missing,
      note:
        this.config.mode === 'mock'
          ? 'Running against the seeded read-only portfolio model. No Robinhood connection is attempted.'
          : this.config.mode === 'manual'
            ? 'Positions are maintained manually in the application database.'
            : 'Configured for the official Robinhood agentic/MCP surface.',
    };
  }

  async authenticate() {
    if (this.config.mode !== 'live') {
      return { ok: true, message: `Robinhood adapter in ${this.config.mode} mode — no authentication required.` };
    }
    if (!this.isConfigured()) {
      const { missing } = this.configurationStatus();
      throw new BrokerNotConfiguredError('Robinhood', missing);
    }
    // The official agentic surface is not yet wired. Failing loudly is correct:
    // silently degrading to mock data while claiming a live connection would be
    // the most dangerous possible behaviour for this application.
    return {
      ok: false,
      message:
        'Robinhood live mode is declared but the official agentic/MCP integration is not implemented in this build. Set ROBINHOOD_MODE=mock or manual.',
    };
  }

  async getAccountData(): Promise<BrokerAccountData> {
    if (this.config.mode === 'live') {
      const auth = await this.authenticate();
      if (!auth.ok) throw new BrokerNotConfiguredError('Robinhood', ['official agentic/MCP integration']);
    }
    return this.fallback();
  }

  async previewOrder(order: ProposedOrder): Promise<OrderPreviewResult> {
    return {
      accepted: false,
      estimatedPrice: null,
      estimatedShares: null,
      estimatedCommission: 0,
      warnings: [
        `Robinhood does not expose an order-preview endpoint to this build. The ${order.symbol} preview shown is produced entirely by the local risk engine.`,
      ],
      previewToken: null,
    };
  }

  async placeOrder(): Promise<OrderStatus> {
    throw new ExecutionDisabledError('Robinhood');
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

/** Shape of the read-only portfolio model this adapter serves. */
export type RobinhoodReadOnlyModel = { accounts: Account[]; holdings: Holding[] };
