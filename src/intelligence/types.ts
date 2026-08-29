export type IntelligenceSector = 'semiconductors' | 'energy' | 'shipping' | 'technology' | 'cross_market';

export type IntelligenceSourceClass =
  | 'primary_source'
  | 'market_news'
  | 'corporate'
  | 'capital_signal'
  | 'policy_proxy'
  | 'supply_chain'
  | 'analyst_commentary'
  | 'openbb';

export type IntelligenceLatency =
  | 'real_time'
  | 'near_real_time'
  | 'delayed_disclosure'
  | 'retrospective'
  | 'unknown';

export type IntelligenceDirection = 'constructive' | 'restrictive' | 'mixed' | 'neutral' | 'unknown';
export type IntelligenceSeverity = 'high' | 'medium' | 'low' | 'info';

export type SemiconductorEventType =
  | 'EXPORT_CONTROL_TIGHTEN'
  | 'EXPORT_CONTROL_RELAX'
  | 'CHIPS_FUNDING'
  | 'TRADE_TARIFF_ACTION'
  | 'FAB_EXPANSION'
  | 'FAB_DELAY'
  | 'CAPEX_RAISE'
  | 'CAPEX_CUT'
  | 'AI_DEMAND_RAISE'
  | 'AI_DEMAND_WEAKEN'
  | 'INVENTORY_BUILD'
  | 'INVENTORY_CLEAR'
  | 'TAIWAN_SECURITY_ESCALATE'
  | 'TAIWAN_SECURITY_DEESCALATE'
  | 'EARNINGS_GUIDANCE_SHOCK';

export type EnergyEventType =
  | 'OPEC_PRODUCTION_CUT'
  | 'OPEC_PRODUCTION_RAISE'
  | 'EIA_INVENTORY_SURPRISE'
  | 'FERC_APPROVAL'
  | 'FERC_RESTRICTION'
  | 'LNG_CAPACITY_CHANGE'
  | 'SANCTIONS_TIGHTEN'
  | 'SANCTIONS_RELAX'
  | 'GRID_CAPEX'
  | 'NUCLEAR_POLICY'
  | 'URANIUM_SUPPLY_SHOCK'
  | 'POWER_DEMAND_CHANGE';

export type ShippingEventType =
  | 'FREIGHT_RATE_RISE'
  | 'FREIGHT_RATE_FALL'
  | 'TANKER_TIGHTENING'
  | 'DRY_BULK_TIGHTENING'
  | 'CONTAINER_TIGHTENING'
  | 'LNG_SHIPPING_CHANGE'
  | 'VESSEL_SUPPLY_CHANGE'
  | 'ORDERBOOK_CHANGE'
  | 'CANAL_DISRUPTION'
  | 'HORMUZ_DISRUPTION'
  | 'RED_SEA_DISRUPTION'
  | 'PORT_FEE_TARIFF'
  | 'MARITIME_SANCTIONS'
  | 'SHIPPING_ANALYST_VIEW';

export type TechnologyEventType =
  | 'AI_CAPEX_CHANGE'
  | 'CLOUD_DEMAND_CHANGE'
  | 'ADVERTISING_DEMAND_CHANGE'
  | 'RETAIL_DEMAND_CHANGE'
  | 'TECH_REGULATION'
  | 'MEGA_CAP_EARNINGS'
  | 'TECH_VALUATION_CHANGE';

export type IntelligenceEventType =
  | SemiconductorEventType
  | EnergyEventType
  | ShippingEventType
  | TechnologyEventType
  | 'CAPITAL_DISCLOSURE'
  | 'MARKET_NEWS'
  | 'OTHER';

export interface IntelligenceEvent {
  fingerprint: string;
  occurredAt: string;
  discoveredAt: string;
  source: string;
  sourceClass: IntelligenceSourceClass;
  sourceUrl: string | null;
  sourceQuality: number;
  sector: IntelligenceSector;
  eventType: IntelligenceEventType;
  headline: string;
  summary: string;
  symbols: string[];
  latency: IntelligenceLatency;
  direction: IntelligenceDirection;
  severity: IntelligenceSeverity;
  sentimentScore: number | null;
  metadata?: Record<string, unknown>;
}

export interface IntelligenceProviderStatus {
  provider: 'finnhub' | 'openbb' | 'primary_sources' | 'ainvest' | 'shipping_commentary';
  connected: boolean;
  status: 'live' | 'partial' | 'not_configured' | 'unavailable';
  note: string;
}

export interface IntelligencePulse {
  sector: Exclude<IntelligenceSector, 'cross_market'>;
  label: 'Constructive' | 'Watching' | 'Cautious' | 'Neutral';
  score: number;
  market: 'positive' | 'neutral' | 'negative' | 'unknown';
  policy: 'constructive' | 'neutral' | 'restrictive' | 'mixed' | 'unknown';
  newsPressure: 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown';
  capitalSignals: 'constructive' | 'neutral' | 'cautious' | 'mixed' | 'unknown';
  eventCount: number;
  highImpactCount: number;
}

export interface HistoricalRelevance {
  eventType: IntelligenceEventType;
  sector: IntelligenceSector;
  sampleSize: number;
  oneDay: { count: number; median: number | null; min: number | null; max: number | null };
  fiveDay: { count: number; median: number | null; min: number | null; max: number | null };
  twentyDay: { count: number; median: number | null; min: number | null; max: number | null };
  currentRegime: string | null;
  summary: string;
}

export interface IntelligencePayload {
  asOf: string;
  providers: IntelligenceProviderStatus[];
  pulses: IntelligencePulse[];
  events: IntelligenceEvent[];
  capitalSignals: IntelligenceEvent[];
  policyEvents: IntelligenceEvent[];
  note: string;
}
