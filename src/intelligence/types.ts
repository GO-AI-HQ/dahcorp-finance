export type IntelligenceSector = 'semiconductors' | 'energy' | 'shipping' | 'technology' | 'cross_market';

export type IntelligenceSourceClass =
  | 'primary_source'
  | 'market_news'
  | 'corporate'
  | 'capital_signal'
  | 'policy_proxy'
  | 'supply_chain'
  | 'analyst_commentary'
  | 'market_benchmark'
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
  | 'MARKET_BENCHMARK_TREND'
  | 'MACRO_REGIME_UPDATE'
  | 'ECONOMIC_CALENDAR_EVENT'
  | 'EARNINGS_CALENDAR_EVENT'
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
  provider: 'finnhub' | 'openbb' | 'tradingeconomics' | 'primary_sources' | 'ainvest' | 'shipping_commentary';
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

export type MarketPulseState = 'Improving' | 'Constructive' | 'Neutral' | 'Weakening' | 'Defensive' | 'Unavailable';

export interface MarketBenchmarkLeg {
  name: string;
  symbol: string;
  provider: 'tradingeconomics' | 'openbb';
  last: number | null;
  return5d: number | null;
  return30d: number | null;
  asOf: string;
}

export interface MarketPulseTickerItem {
  sector: Exclude<IntelligenceSector, 'cross_market'>;
  state: MarketPulseState;
  benchmarks: MarketBenchmarkLeg[];
  confirmation: MarketBenchmarkLeg | null;
  dataRole: 'primary' | 'proxy_fallback' | 'unavailable';
  summary: string;
}

export interface MacroRegimeSeries {
  series: string;
  label: string;
  latest: number | null;
  prior30d: number | null;
  change30d: number | null;
  asOf: string | null;
  source: 'fred';
}

export interface MacroRegimeSnapshot {
  asOf: string;
  series: MacroRegimeSeries[];
  yieldCurve10y2y: number | null;
  vix: number | null;
  highYieldSpread: number | null;
  financialConditions: number | null;
  fedFunds: number | null;
  regime: 'risk_on' | 'balanced' | 'risk_off' | 'insufficient_data';
  note: string;
}

export interface EconomicCalendarItem {
  date: string;
  event: string;
  country: string | null;
  actual: number | string | null;
  consensus: number | string | null;
  previous: number | string | null;
  importance: string | null;
  source: 'openbb';
}

export interface SecurityReference {
  symbol: string;
  displaySymbol: string | null;
  name: string | null;
  type: string | null;
  currency: string | null;
  mic: string | null;
  figi: string | null;
  industry: string | null;
  marketCapitalization: number | null;
  weburl: string | null;
  source: 'finnhub';
}

export interface ReferenceRegistry {
  asOf: string;
  exchange: string;
  symbols: SecurityReference[];
  source: 'finnhub';
  note: string;
}

export interface GovernmentTradingSignal {
  fingerprint: string;
  sector: Exclude<IntelligenceSector, 'cross_market'>;
  symbol: string;
  trader: string;
  party: string | null;
  state: string | null;
  tradeType: 'buy' | 'sell' | 'other';
  tradeDate: string | null;
  filingDate: string | null;
  reportingGapDays: number | null;
  size: string | null;
  relatedEventFingerprint: string | null;
  relatedHeadline: string | null;
  relatedSource: string | null;
  relation: 'before' | 'near' | 'after' | 'none';
  daysFromEvent: number | null;
  correlation: string;
  strategicUse: string;
}

export type AssetDecisionAction = 'BUY' | 'ADD' | 'HOLD' | 'WAIT' | 'REDUCE' | 'SELL';

export interface AssetDecision {
  symbol: string;
  sector: Exclude<IntelligenceSector, 'cross_market'>;
  action: AssetDecisionAction;
  rationale: string;
  modelQuestion: string;
  priority: number;
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
  marketPulse: MarketPulseTickerItem[];
  macroRegime: MacroRegimeSnapshot;
  economicCalendar: EconomicCalendarItem[];
  referenceRegistry: ReferenceRegistry;
  governmentTrading: GovernmentTradingSignal[];
  events: IntelligenceEvent[];
  capitalSignals: IntelligenceEvent[];
  policyEvents: IntelligenceEvent[];
  note: string;
}