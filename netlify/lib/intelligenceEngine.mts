import type { IntelligenceEvent, IntelligencePayload, IntelligenceProviderStatus } from '../../src/intelligence/types.js';
import { buildIntelligencePulse } from '../../src/intelligence/scoring.js';
import { fetchFinnhubIntelligence } from './finnhub.mts';
import { fetchOpenBBIntelligence } from './openbb.mts';
import { fetchPrimaryPolicyIntelligence } from './primaryPolicy.mts';
import { fetchAInvestCongressIntelligence } from './ainvest.mts';
import { fetchShippingCommentary } from './shippingCommentary.mts';
import { persistIntelligenceEvents, recentIntelligenceEvents } from './intelligenceStore.mts';

function dedupe(events: IntelligenceEvent[]): IntelligenceEvent[] {
  const map = new Map<string, IntelligenceEvent>();
  for (const event of events) {
    const prior = map.get(event.fingerprint);
    if (!prior || new Date(event.discoveredAt).getTime() >= new Date(prior.discoveredAt).getTime()) map.set(event.fingerprint, event);
  }
  return [...map.values()].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

export async function refreshMarketIntelligence(): Promise<{
  events: IntelligenceEvent[];
  providers: IntelligenceProviderStatus[];
  persisted: number;
}> {
  const [finnhub, primary, openbb, ainvest, shipping] = await Promise.all([
    fetchFinnhubIntelligence(),
    fetchPrimaryPolicyIntelligence(),
    fetchOpenBBIntelligence(),
    fetchAInvestCongressIntelligence(),
    fetchShippingCommentary(),
  ]);
  const events = dedupe([
    ...finnhub.events,
    ...primary.events,
    ...openbb.events,
    ...ainvest.events,
    ...shipping.events,
  ]);
  const persisted = await persistIntelligenceEvents(events);
  return { events, providers: [finnhub.status, primary.status, openbb.status, ainvest.status, shipping.status], persisted };
}

function configuredStatus(): IntelligenceProviderStatus[] {
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
      provider: 'openbb',
      connected: Boolean(Netlify.env.get('OPENBB_REST_URL')),
      status: Netlify.env.get('OPENBB_REST_URL') ? 'partial' : 'not_configured',
      note: Netlify.env.get('OPENBB_REST_URL')
        ? 'OpenBB service boundary is configured; live status is confirmed during refresh.'
        : 'OpenBB remains isolated until an external REST service is deployed.',
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
  if (options.refresh) {
    const refreshed = await refreshMarketIntelligence();
    providers = refreshed.providers;
    fresh = refreshed.events;
  } else {
    providers = configuredStatus();
  }

  const stored = await recentIntelligenceEvents(options.limit ?? 140);
  const events = dedupe([...fresh, ...stored]).slice(0, options.limit ?? 140);
  const asOf = new Date().toISOString();
  return {
    asOf,
    providers,
    pulses: [
      buildIntelligencePulse('semiconductors', events, new Date(asOf)),
      buildIntelligencePulse('energy', events, new Date(asOf)),
      buildIntelligencePulse('shipping', events, new Date(asOf)),
      buildIntelligencePulse('technology', events, new Date(asOf)),
    ],
    events,
    capitalSignals: events.filter((event) => event.sourceClass === 'capital_signal' || event.sourceClass === 'policy_proxy'),
    policyEvents: events.filter((event) => event.sourceClass === 'primary_source'),
    note: events.length
      ? 'DAHCorp promotes intelligence only when it is relevant to an active strategy. Public disclosures and analyst commentary remain evidence inputs, not standalone trade instructions.'
      : 'No stored intelligence events yet. Refresh the feed or wait for the scheduled observer; missing evidence is never treated as neutral evidence.',
  };
}
