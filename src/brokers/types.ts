import type { Account, BrokerId, Holding } from '../core/types.js';
import type { ProposedOrder } from '../risk/types.js';

/**
 * Broker adapter interface.
 *
 * Every broker sits behind this interface. The architecture is deliberately:
 *
 *   Claude → Portfolio Service → Risk Engine → Broker Adapter
 *
 * and never Claude → raw broker credentials. Adapters are constructed
 * server-side only, from Netlify environment variables, and are never
 * instantiated in browser code.
 */
export type BrokerCapability =
  | 'read_accounts'
  | 'read_positions'
  | 'read_quotes'
  | 'preview_order'
  | 'place_order'
  | 'order_status';

export interface BrokerAccountData {
  accounts: Account[];
  holdings: Holding[];
  /** Provider-reported timestamp. */
  asOf: string;
}

export interface OrderPreviewResult {
  accepted: boolean;
  /** Broker-side estimate, when the broker provides one. */
  estimatedPrice: number | null;
  estimatedShares: number | null;
  estimatedCommission: number;
  /** Broker-side warnings, distinct from our own risk findings. */
  warnings: string[];
  /** Opaque token some brokers require to submit a previewed order. */
  previewToken: string | null;
}

export interface OrderStatus {
  brokerOrderId: string | null;
  status: 'not_submitted' | 'pending' | 'filled' | 'partial' | 'rejected' | 'cancelled';
  filledShares: number;
  filledAveragePrice: number | null;
  message: string;
}

export interface BrokerAdapter {
  readonly id: BrokerId;
  readonly label: string;
  readonly capabilities: BrokerCapability[];
  /** True when live credentials are present and the adapter is usable. */
  isConfigured(): boolean;
  /** Human-readable description of what is missing when not configured. */
  configurationStatus(): { configured: boolean; missing: string[]; note: string };
  authenticate(): Promise<{ ok: boolean; message: string }>;
  getAccountData(): Promise<BrokerAccountData>;
  previewOrder(order: ProposedOrder): Promise<OrderPreviewResult>;
  /** Must throw in Phase 1. Execution is not enabled in this build. */
  placeOrder(order: ProposedOrder, previewToken: string | null): Promise<OrderStatus>;
  getOrderStatus(brokerOrderId: string): Promise<OrderStatus>;
}

/** Thrown when execution is attempted while it is disabled. */
export class ExecutionDisabledError extends Error {
  constructor(broker: string) {
    super(
      `Live order execution is disabled for ${broker}. This build implements Phase 1 (observer) only: orders can be previewed and validated, never placed.`,
    );
    this.name = 'ExecutionDisabledError';
  }
}

export class BrokerNotConfiguredError extends Error {
  constructor(broker: string, missing: string[]) {
    super(`${broker} adapter is not configured. Missing: ${missing.join(', ') || 'credentials'}.`);
    this.name = 'BrokerNotConfiguredError';
  }
}
