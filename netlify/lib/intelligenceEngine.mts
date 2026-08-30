import type {
  EconomicCalendarItem,
  IntelligenceEvent,
  IntelligencePayload,
  IntelligenceProviderStatus,
  MacroRegimeSeries,
  MacroRegimeSnapshot,
  MarketBenchmarkLeg,
  MarketPulseTickerItem,
  ReferenceRegistry,
  SecurityReference,
} from '../../src/intelligence/types.js';
import { buildIntelligencePulse } from '../../src/intelligence/scoring.js';
import { correlateGovernmentTrades } from '../../src/intelligence/correlation.js';
import { marketPulseNarrative, marketPulseState } from '../../src/intelligence/marketPulse.js';
import { fetchFinnhubIntelligence } from './finnhub.mts';
import { fetchOpenBBIntelligence } from './openbb.mts';
import { fetchPrimaryPolicyIntelligence } from './primaryPolicy.mts';
import { fetchAInvestCongressIntelligence } from './ainvest.mts';
import { fetchShippingCommentary } from './shippingCommentary.mts';
import { persistIntelligenceEvents, recentIntelligenceEvents } from './intelligenceStore.mts';

type Sector = 'shipping' | 'semiconductors' | 'energy' | 'technology';
const SECTORS: Sector[] = ['shipping', 'semiconductors', 'energy', 'technology'];

function dedupe(events: IntelligenceEvent[]): IntelligenceEvent[] {
  const map = new Map<string, IntelligenceEvent>();
  for (const event of events) {
    const prior = map.get(event.fingerprint);
    if (!prior || new Date(event.discoveredAt).getTime() >= new Date(prior.discoveredAt).getTime()) map.set(event.fingerprint, event);
  }
  return [...map.values()].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function referenceRegistryEvent(registry: ReferenceRegistry): Promise<IntelligenceEvent | null> {
  if (!registry.symbols.length) return null;
  return {
    fingerprint: await fingerprint(['finnhub-reference-registry', registry.asOf.slice(0, 13), String(registry.symbols.length)]),
    occurredAt: registry.asOf,
    discoveredAt: new Date().toISOString(),
    source: 'Finnhub US security reference registry',
    sourceClass: 'corporate',
    sourceUrl: null,
    sourceQuality: 0.9,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `Finnhub reference registry refreshed for ${registry.symbols.length} strategy-relevant securities`,
    summary: 'Ticker metadata is reference evidence only. Registry inclusion never authorizes trading or expands the deterministic allowlist.',
    symbols: registry.symbols.map((row) => row.symbol),
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: { referenceRegistry: registry },
  };
}

function metadataNumber(event: IntelligenceEvent, key: string): number | null {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataState(event: IntelligenceEvent) {
  const value = event.metadata?.state;
  return ['Improving', 'Constructive', 'Neutral', 'Weakening', 'Defensive', 'Unavailable'].includes(String(value))
    ? value as MarketPulseTickerItem['state']
    : marketPulseState(metadataNumber(event, 'return5d'), metadataNumber(event, 'return30d'));
}

function marketPulseFromEvents(events: IntelligenceEvent[]): MarketPulseTickerItem[] {
  const primaryEvents = events.filter((event) => event.sourceClass === 'market_benchmark' && event.eventType === 'MARKET_BENCHMARK_TREND');
  return SECTORS.map((sector) => {
    const event = primaryEvents.find((candidate) => candidate.sector === sector);
    if (!event || !event.symbols.length) {
      return {
        sector,
        state: 'Unavailable',
        benchmarks: [],
        confirmation: null,
        dataRole: 'unavailable',
        summary: marketPulseNarrative(sector, 'Unavailable'),
      };
    }
    const benchmarks: MarketBenchmarkLeg[] = event.symbols.map((symbol) => ({
      name: symbol,
      symbol,
      provider: 'openbb',
      last: null,
      return5d: metadataNumber(event, 'return5d'),
      return30d: metadataNumber(event, 'return30d'),
      asOf: event.occurredAt,
    }));
    return {
      sector,
      state: metadataState(event),
      benchmarks,
      confirmation: null,
      dataRole: 'primary',
      summary: event.summary,
    };
  });
}

const EMPTY_MACRO = (asOf = new Date().toISOString()): MacroRegimeSnapshot => ({
  asOf,
  series: [],
  yieldCurve10y2y: null,
  vix: null,
  highYieldSpread: null,
  financialConditions: null,
  fedFunds: null,
  regime: 'insufficient_data',
  note: 'Macro regime evidence is unavailable; missing values are UNKNOWN and are not replaced with fixtures.',
});

const EMPTY_REGISTRY = (asOf = new Date().toISOString()): ReferenceRegistry => ({
  asOf,
  exchange: 'US',
  symbols: [],
  source: 'finnhub',
  note: 'Finnhub reference registry is unavailable; no synthetic ticker metadata is substituted.',
});

function macroFromEvents(events: IntelligenceEvent[]): MacroRegimeSnapshot {
  const event = events.find((candidate) => candidate.eventType === 'MACRO_REGIME_UPDATE' && candidate.sourceClass === 'market_benchmark');
  const raw = event?.metadata;
  if (!event || !raw) return EMPTY_MACRO();
  const seriesRaw = Array.isArray(raw.series) ? raw.series : [];
  const series: MacroRegimeSeries[] = seriesRaw.map((row) => {
    const item = row as Partial<MacroRegimeSeries>;
    return {
      series: String(item.series ?? ''),
      label: String(item.label ?? item.series ?? ''),
      latest: typeof item.latest === 'number' && Number.isFinite(item.latest) ? item.latest : null,
      prior30d: typeof item.prior30d === 'number' && Number.isFinite(item.prior30d) ? item.prior30d : null,
      change30d: typeof item.change30d === 'number' && Number.isFinite(item.change30d) ? item.change30d : null,
      asOf: typeof item.asOf === 'string' ? item.asOf : null,
      source: 'fred',
    };
  }).filter((row) => row.series);
  const regime = ['risk_on', 'balanced', 'risk_off', 'insufficient_data'].includes(String(raw.regime))
    ? raw.regime as MacroRegimeSnapshot['regime']
    : 'insufficient_data';
  const num = (key: string) => typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] as number : null;
  return {
    asOf: typeof raw.asOf === 'string' ? raw.asOf : event.occurredAt,
    series,
    yieldCurve10y2y: num('yieldCurve10y2y'),
    vix: num('vix'),
    highYieldSpread: num('highYieldSpread'),
    financialConditions: num('financialConditions'),
    fedFunds: num('fedFunds'),
    regime,
    note: typeof raw.note === 'string' ? raw.note : 'Stored FRED macro regime snapshot.',
  };
}

function calendarFromEvents(events: IntelligenceEvent[]): EconomicCalendarItem[] {
  return events
    .filter((event) => event.eventType === 'ECONOMIC_CALENDAR_EVENT')
    .slice(0, 80)
    .map((event) => {
      const raw = event.metadata ?? {};
      return {
        date: typeof raw.date === 'string' ? raw.date : event.occurredAt.slice(0, 10),
        event: typeof raw.event === 'string' ? raw.event : event.headline,
        country: typeof raw.country === 'string' ? raw.country : null,
        actual: typeof raw.actual === 'number' || typeof raw.actual === 'string' ? raw.actual : null,
        consensus: typeof raw.consensus === 'number' || typeof raw.consensus === 'string' ? raw.consensus : null,
        previous: typeof raw.previous === 'number' || typeof raw.previous === 'string' ? raw.previous : null,
        importance: typeof raw.importance === 'string' ? raw.importance : null,
        source: 'openbb' as const,
      };
    });
}

function validSecurityReference(value: unknown): SecurityReference | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<SecurityReference>;
  if (typeof row.symbol !== 'string' || !row.symbol) return null;
  return {
    symbol: row.symbol,
    displaySymbol: typeof row.displaySymbol === 'string' ? row.displaySymbol : null,
    name: typeof row.name === 'string' ? row.name : null,
    type: typeof row.type === 'string' ? row.type : null,
    currency: typeof row.currency === 'string' ? row.currency : null,
    mic: typeof row.mic === 'string' ? row.mic : null,
    figi: typeof row.figi === 'string' ? row.figi : null,
    industry: typeof row.industry === 'string' ? row.industry : null,
    marketCapitalization: typeof row.marketCapitalization === 'number' && Number.isFinite(row.marketCapitalization) ? row.marketCapitalization : null,
    weburl: typeof row.weburl === 'string' ? row.weburl : null,
    source: 'finnhub',
  };
}

function registryFromEvents(events: IntelligenceEvent[]): ReferenceRegistry {
  const event = events.find((candidate) => candidate.metadata?.referenceRegistry && candidate.source === 'Finnhub US security reference registry');
  const raw = event?.metadata?.referenceRegistry;
  if (!raw || typeof raw !== 'object') return EMPTY_REGISTRY();
  const value = raw as Partial<ReferenceRegistry>;
  const symbols = Array.isArray(value.symbols) ? value.symbols.map(validSecurityReference).filter((row): row is SecurityReference => row !== null) : [];
  return {
    asOf: typeof value.asOf === 'string' ? value.asOf : event?.occurredAt ?? new Date().toISOString(),
    exchange: typeof value.exchange === 'string' ? value.exchange : 'US',
    symbols,
    source: 'finnhub',
    note: typeof value.note === 'string' ? value.note : 'Stored Finnhub security reference snapshot.',
  };
}

export async function refreshMarketIntelligence(): Promise<{
  events: IntelligenceEvent[];
  providers: IntelligenceProviderStatus[];
  marketPulse: MarketPulseTickerItem[];
  macroRegime: MacroRegimeSnapshot;
  economicCalendar: EconomicCalendarItem[];
  referenceRegistry: ReferenceRegistry;
  persisted: number;
}> {
  const [finnhub, primary, openbb, ainvest, shipping] = await Promise.all([
    fetchFinnhubIntelligence(),
    fetchPrimaryPolicyIntelligence(),
    fetchOpenBBIntelligence(),
    fetchAInvestCongressIntelligence(),
    fetchShippingCommentary(),
  ]);
  const registryEvent = await referenceRegistryEvent(finnhub.referenceRegistry);
  const events = dedupe([
    ...finnhub.events,
    ...primary.events,
    ...openbb.events,
    ...ainvest.events,
    ...shipping.events,
    ...(registryEvent ? [registryEvent] : []),
  ]);
  const persisted = await persistIntelligenceEvents(events);
  return {
    events,
    providers: [finnhub.status, primary.status, openbb.status, ainvest.status, shipping.status],
    marketPulse: openbb.marketPulse,
    macroRegime: openbb.macroRegime,
    economicCalendar: openbb.economicCalendar,
    referenceRegistry: finnhub.referenceRegistry,
    persisted,
  };
}

function configuredStatus(): IntelligenceProviderStatus[] {
  const openbbConfigured = Boolean(Netlify.env.get('OPENBB_GATEWAY_URL') && Netlify.env.get('OPENBB_GATEWAY_SIGNING_KEY'));
  return [
    {
      provider: 'finnhub',
      connected: Boolean(Netlify.env.get('FINNHUB_API_KEY')),
      status: Netlify.env.get('FINNHUB_API_KEY') ? 'live' : 'not_configured',
      note: 'Finnhub reference/company-event status is confirmed during the scheduled refresh.',
    },
    {
      provider: 'primary_sources',
      connected: true,
      status: 'live',
      note: 'Federal Register policy lane is available; live status is confirmed during refresh.',
    },
    {
      provider: 'openbb',
      connected: openbbConfigured,
      status: openbbConfigured ? 'live' : 'not_configured',
      note: openbbConfigured
        ? 'OpenBB signed Cloud Run gateway is configured as the primary benchmark/macro fabric; live route status is confirmed during refresh.'
        : 'Configure the signed OpenBB gateway to activate primary market/macro intelligence.',
    },
    {
      provider: 'ainvest',
      connected: Boolean(Netlify.env.get('AINVEST_API_KEY') || Netlify.env.get('AINVEST_KEY')),
      status: Netlify.env.get('AINVEST_API_KEY') || Netlify.env.get('AINVEST_KEY') ? 'live' : 'not_configured',
      note: 'Ticker-specific congressional disclosures are verified during refresh and always retain filing latency.',
    },
    {
      provider: 'shipping_commentary',
      connected: true,
      status: 'partial',
      note: 'Public maritime specialist feeds are probed during refresh. Commentary never acts as a standalone trade trigger.',
    },
  ];
}

export async function buildMarketIntelligencePayload(options: { refresh?: boolean; limit?: number } = {}): Promise<IntelligencePayload> {
  let providers: IntelligenceProviderStatus[];
  let fresh: IntelligenceEvent[] = [];
  let freshMarketPulse: MarketPulseTickerItem[] | null = null;
  let freshMacro: MacroRegimeSnapshot | null = null;
  let freshCalendar: EconomicCalendarItem[] | null = null;
  let freshRegistry: ReferenceRegistry | null = null;
  if (options.refresh) {
    const refreshed = await refreshMarketIntelligence();
    providers = refreshed.providers;
    fresh = refreshed.events;
    freshMarketPulse = refreshed.marketPulse;
    freshMacro = refreshed.macroRegime;
    freshCalendar = refreshed.economicCalendar;
    freshRegistry = refreshed.referenceRegistry;
  } else {
    providers = configuredStatus();
  }

  const stored = await recentIntelligenceEvents(options.limit ?? 180);
  const events = dedupe([...fresh, ...stored]).slice(0, options.limit ?? 180);
  const asOf = new Date().toISOString();
  const marketPulse = freshMarketPulse ?? marketPulseFromEvents(events);
  const macroRegime = freshMacro ?? macroFromEvents(events);
  const economicCalendar = freshCalendar ?? calendarFromEvents(events);
  const referenceRegistry = freshRegistry ?? registryFromEvents(events);
  const pulses = [
    buildIntelligencePulse('semiconductors', events, new Date(asOf)),
    buildIntelligencePulse('energy', events, new Date(asOf)),
    buildIntelligencePulse('shipping', events, new Date(asOf)),
    buildIntelligencePulse('technology', events, new Date(asOf)),
  ];
  return {
    asOf,
    providers,
    pulses,
    marketPulse,
    macroRegime,
    economicCalendar,
    referenceRegistry,
    governmentTrading: correlateGovernmentTrades(events),
    events,
    capitalSignals: events.filter((event) => event.sourceClass === 'capital_signal' || event.sourceClass === 'policy_proxy'),
    policyEvents: events.filter((event) => event.sourceClass === 'primary_source'),
    note: events.length
      ? 'OpenBB is the primary market/macro fabric and Finnhub is the security-reference/company-event layer. All intelligence remains evidence only; deterministic policy controls eligibility and execution.'
      : 'No stored production intelligence events are available yet. Missing evidence remains UNKNOWN; mock intelligence is never substituted.',
  };
}
