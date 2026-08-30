import type {
  IntelligenceEvent,
  IntelligencePayload,
  IntelligenceProviderStatus,
  IntelligenceSector,
  MarketBenchmarkLeg,
  MarketPulseState,
  MarketPulseTickerItem,
} from '../../src/intelligence/types.js';
import { buildIntelligencePulse } from '../../src/intelligence/scoring.js';
import { correlateGovernmentTrades } from '../../src/intelligence/correlation.js';
import { marketPulseNarrative, marketPulseState } from '../../src/intelligence/marketPulse.js';
import { fetchFinnhubIntelligence } from './finnhub.mts';
import { fetchOpenBBIntelligence } from './openbb.mts';
import { fetchTradingEconomicsMarketPulse } from './tradingEconomics.mts';
import { fetchPrimaryPolicyIntelligence } from './primaryPolicy.mts';
import { fetchAInvestCongressIntelligence } from './ainvest.mts';
import { fetchShippingCommentary } from './shippingCommentary.mts';
import { persistIntelligenceEvents, recentIntelligenceEvents } from './intelligenceStore.mts';

type Sector = Exclude<IntelligenceSector, 'cross_market'>;
const SECTORS: Sector[] = ['shipping', 'semiconductors', 'energy', 'technology'];

function dedupe(events: IntelligenceEvent[]): IntelligenceEvent[] {
  const map = new Map<string, IntelligenceEvent>();
  for (const event of events) {
    const prior = map.get(event.fingerprint);
    if (!prior || new Date(event.discoveredAt).getTime() >= new Date(prior.discoveredAt).getTime()) map.set(event.fingerprint, event);
  }
  return [...map.values()].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function mergeMarketPulse(
  primary: MarketPulseTickerItem[],
  confirmations: Partial<Record<Sector, MarketBenchmarkLeg>>,
): MarketPulseTickerItem[] {
  return SECTORS.map((sector) => {
    const row = primary.find((item) => item.sector === sector);
    const confirmation = confirmations[sector] ?? null;
    if (row?.benchmarks.length) return { ...row, confirmation };
    if (confirmation) {
      const state = marketPulseState(confirmation.return5d, confirmation.return30d);
      return {
        sector,
        state,
        benchmarks: [confirmation],
        confirmation: null,
        dataRole: 'proxy_fallback',
        summary: `Primary macro benchmark is unavailable. ${confirmation.symbol} is being used only as a liquid proxy confirmation. ${marketPulseNarrative(sector, state)}`,
      };
    }
    return {
      sector,
      state: 'Unavailable',
      benchmarks: [],
      confirmation: null,
      dataRole: 'unavailable',
      summary: marketPulseNarrative(sector, 'Unavailable'),
    };
  });
}

function metadataNumber(event: IntelligenceEvent, key: string): number | null {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataState(event: IntelligenceEvent): MarketPulseState {
  const value = event.metadata?.state;
  return ['Improving', 'Constructive', 'Neutral', 'Weakening', 'Defensive', 'Unavailable'].includes(String(value))
    ? value as MarketPulseState
    : marketPulseState(metadataNumber(event, 'return5d'), metadataNumber(event, 'return30d'));
}

function benchmarkName(symbol: string): string {
  const normalized = symbol.toLowerCase();
  if (normalized === 'baltic:com') return 'BDI';
  if (normalized === 'sox:ind') return 'SOX';
  if (normalized === 'cl1:com') return 'WTI';
  if (normalized === 'co1:com') return 'Brent';
  if (normalized === 'ndx:ind') return 'NDX';
  return symbol.toUpperCase();
}

function marketPulseFromEvents(events: IntelligenceEvent[]): MarketPulseTickerItem[] {
  const primaryEvents = events.filter((event) => event.sourceClass === 'market_benchmark' && event.eventType === 'MARKET_BENCHMARK_TREND');
  const confirmationEvents = events.filter((event) => event.sourceClass === 'openbb' && event.eventType === 'MARKET_BENCHMARK_TREND');
  return SECTORS.map((sector) => {
    const primary = primaryEvents.find((event) => event.sector === sector);
    const confirmationEvent = confirmationEvents.find((event) => event.sector === sector);
    const confirmation: MarketBenchmarkLeg | null = confirmationEvent?.symbols[0]
      ? {
          name: confirmationEvent.symbols[0],
          symbol: confirmationEvent.symbols[0],
          provider: 'openbb',
          last: null,
          return5d: metadataNumber(confirmationEvent, 'return5d'),
          return30d: metadataNumber(confirmationEvent, 'return30d'),
          asOf: confirmationEvent.occurredAt,
        }
      : null;
    if (primary) {
      const benchmarks: MarketBenchmarkLeg[] = primary.symbols.map((symbol) => ({
        name: benchmarkName(symbol),
        symbol,
        provider: 'tradingeconomics',
        last: null,
        return5d: metadataNumber(primary, 'return5d'),
        return30d: metadataNumber(primary, 'return30d'),
        asOf: primary.occurredAt,
      }));
      return {
        sector,
        state: metadataState(primary),
        benchmarks,
        confirmation,
        dataRole: 'primary',
        summary: primary.summary,
      };
    }
    if (confirmation) {
      const state = metadataState(confirmationEvent as IntelligenceEvent);
      return {
        sector,
        state,
        benchmarks: [confirmation],
        confirmation: null,
        dataRole: 'proxy_fallback',
        summary: `Primary macro benchmark is unavailable. ${confirmation.symbol} remains a proxy-only read. ${marketPulseNarrative(sector, state)}`,
      };
    }
    return { sector, state: 'Unavailable', benchmarks: [], confirmation: null, dataRole: 'unavailable', summary: marketPulseNarrative(sector, 'Unavailable') };
  });
}

export async function refreshMarketIntelligence(): Promise<{
  events: IntelligenceEvent[];
  providers: IntelligenceProviderStatus[];
  marketPulse: MarketPulseTickerItem[];
  persisted: number;
}> {
  const [finnhub, primary, openbb, tradingeconomics, ainvest, shipping] = await Promise.all([
    fetchFinnhubIntelligence(),
    fetchPrimaryPolicyIntelligence(),
    fetchOpenBBIntelligence(),
    fetchTradingEconomicsMarketPulse(),
    fetchAInvestCongressIntelligence(),
    fetchShippingCommentary(),
  ]);
  const events = dedupe([
    ...finnhub.events,
    ...primary.events,
    ...openbb.events,
    ...tradingeconomics.events,
    ...ainvest.events,
    ...shipping.events,
  ]);
  const persisted = await persistIntelligenceEvents(events);
  return {
    events,
    providers: [finnhub.status, primary.status, tradingeconomics.status, openbb.status, ainvest.status, shipping.status],
    marketPulse: mergeMarketPulse(tradingeconomics.marketPulse, openbb.confirmations),
    persisted,
  };
}

function configuredStatus(): IntelligenceProviderStatus[] {
  const teConfigured = Boolean(Netlify.env.get('TRADINGECONOMICS_API_KEY') || Netlify.env.get('TRADING_ECONOMICS_API_KEY') || Netlify.env.get('TE_API_KEY'));
  const openbbConfigured = Boolean(Netlify.env.get('OPENBB_REST_URL'));
  return [
    {
      provider: 'finnhub',
      connected: Boolean(Netlify.env.get('FINNHUB_API_KEY')),
      status: Netlify.env.get('FINNHUB_API_KEY') ? 'live' : 'not_configured',
      note: 'Provider status is confirmed during the next refresh.',
    },
    {
      provider: 'primary_sources',
      connected: true,
      status: 'live',
      note: 'Federal Register policy lane is available; live status is confirmed during refresh.',
    },
    {
      provider: 'tradingeconomics',
      connected: teConfigured,
      status: teConfigured ? 'partial' : 'not_configured',
      note: teConfigured
        ? 'TradingEconomics primary Market Pulse is configured; BDI/SOX/WTI/Brent/NDX status is confirmed during refresh.'
        : 'Configure TRADINGECONOMICS_API_KEY to activate the primary Market Pulse benchmarks.',
    },
    {
      provider: 'openbb',
      connected: openbbConfigured,
      status: openbbConfigured ? 'partial' : 'not_configured',
      note: openbbConfigured
        ? 'OpenBB Cloud Run is configured; IAM and proxy confirmation status are confirmed during refresh.'
        : 'OpenBB remains isolated until OPENBB_REST_URL is configured.',
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
  let providers: IntelligenceProviderStatus[] = [];
  let fresh: IntelligenceEvent[] = [];
  let freshMarketPulse: MarketPulseTickerItem[] | null = null;
  if (options.refresh) {
    const refreshed = await refreshMarketIntelligence();
    providers = refreshed.providers;
    fresh = refreshed.events;
    freshMarketPulse = refreshed.marketPulse;
  } else {
    providers = configuredStatus();
  }

  const stored = await recentIntelligenceEvents(options.limit ?? 140);
  const events = dedupe([...fresh, ...stored]).slice(0, options.limit ?? 140);
  const asOf = new Date().toISOString();
  const marketPulse = freshMarketPulse ?? marketPulseFromEvents(events);
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
    governmentTrading: correlateGovernmentTrades(events),
    events,
    capitalSignals: events.filter((event) => event.sourceClass === 'capital_signal' || event.sourceClass === 'policy_proxy'),
    policyEvents: events.filter((event) => event.sourceClass === 'primary_source'),
    note: events.length
      ? 'DAHCorp promotes intelligence only when it is relevant to an active strategy. Market benchmarks, public disclosures and analyst commentary remain evidence inputs, not standalone trade instructions.'
      : 'No stored intelligence events yet. Refresh the feed or wait for the scheduled observer; missing evidence is never treated as neutral evidence.',
  };
}
