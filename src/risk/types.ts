import type { BrokerId, Sleeve } from '../core/types.js';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

/** A proposed order before it has been validated by the risk engine. */
export interface ProposedOrder {
  id: string;
  accountId: string;
  broker: BrokerId;
  symbol: string;
  side: OrderSide;
  /** Dollar-notional orders are the norm for fractional accumulation. */
  notional?: number;
  /** Share-quantity orders, used for harvests where a portion is sold. */
  quantity?: number;
  orderType: OrderType;
  limitPrice?: number;
  /** Why this order exists, in the strategy's own terms. */
  rationale: string;
  /** Which engine produced it. `claude` remains for historical audit rows. */
  origin: 'agent' | 'claude' | 'harvest_rule' | 'dip_rule' | 'rebalance' | 'manual';
  /**
   * Where the money is coming from. `external_reserve` is always rejected —
   * the household reserve is protected capital and neither an LLM nor the
   * deterministic policy engine may recommend drawing it down.
   */
  fundingSource?: 'broker_cash' | 'new_contribution' | 'sale_proceeds' | 'external_reserve';
  sleeve: Sleeve;
}

export type RiskSeverity = 'info' | 'warning' | 'block';

export interface RiskFinding {
  code: string;
  severity: RiskSeverity;
  message: string;
  /** The configured limit that produced this finding, when applicable. */
  limit?: number;
  actual?: number;
}

export interface ValidatedOrder {
  order: ProposedOrder;
  approved: boolean;
  /** Notional the risk engine is willing to allow, possibly reduced. */
  allowedNotional: number;
  estimatedShares: number | null;
  estimatedPrice: number | null;
  findings: RiskFinding[];
  /** Portfolio impact if the allowed notional executes. */
  impact: {
    postTradeWeight: number | null;
    postTradeSleeveWeight: number | null;
    postTradeLeveragedPct: number | null;
    postTradeCash: number;
    /** Change in modeled forward monthly income. */
    forwardMonthlyIncomeDelta: number | null;
  };
}

export interface RiskDecision {
  asOf: string;
  /** Overall verdict for the whole batch. */
  approved: boolean;
  orders: ValidatedOrder[];
  /** Batch-level findings (reserve breaches, kill switch, phase gates). */
  findings: RiskFinding[];
  /** Total notional the engine will allow across the batch. */
  allowedTotal: number;
  requestedTotal: number;
  /** Execution phase in force at decision time. */
  executionPhase: number;
  /** Always false in Phase 1 analytical validation. Broker-specific guarded execution is separate. */
  executionEnabled: boolean;
}
