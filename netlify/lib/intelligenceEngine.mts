import type { IntelligenceEvent, IntelligencePayload, IntelligenceProviderStatus } from '../../src/intelligence/types.js';
import { buildIntelligencePulse } from '../../src/intelligence/scoring.js';
import { fetchFinnhubIntelligence } from './finnhub.mts';
import { fetchOpenBBIntelligence } from './openbb.mts';
import { fetchPrimaryPolicyIntelligence } from './primaryPolicy.mts';
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
  const [finnhub, primary, openbb] = await Promise.all([
    fetchFinnhubIntelligence(),
    fetchPrimaryPolicyIntelligence(),
    fetchOpenBBIntelligence(),
  ]);
  const events = dedupe([...finnhub.events, ...primary.events, ...openbb.events]);
  const persisted = await persistIntelligenceEvents(events);
  return { events, providers: [finnhub.status, primary.status, openbb.status], persisted };
}

export async function buildMarketIntelligencePayload(options: { refresh?: boolean; limit?: number } = {}): Promise<IntelligencePayload> {
  let providers: IntelligenceProviderStatus[] = [];
  let fresh: IntelligenceEvent[] = [];
  if (options.refresh) {
    const refreshed = await refreshMarketIntelligence();
    providers = refreshed.providers;
    fresh = refreshed.events;
  } else {
    providers = [
      { provider: 'finnhub', connected: Boolean(Netlify.env.get('FINNHUB_API_KEY')), status: Netlify.env.get('FINNHUB_API_KEY') ? 'live' : 'not_configured', note: 'Provider status is confirmed during the next refresh.' },
      { provider: 'primary_sources', connected: true, status: 'live', note: 'Federal Register policy lane is available; live status is confirmed during refresh.' },
      { provider: 'openbb', connected: Boolean(Netlify.env.get('OPENBB_REST_URL')), status: Netlify.env.get('OPENBB_REST_URL') ? 'partial' : 'not_configured', note: Netlify.env.get('OPENBB_REST_URL') ? 'OpenBB service boundary is configured; live status is confirmed during refresh.' : 'OpenBB remains isolated until an external REST service is deployed.' },
    ];
  }

  const stored = await recentIntelligenceEvents(options.limit ?? 100);
  const events = dedupe([...fresh, ...stored]).slice(0, options.limit ?? 100);
  const asOf = new Date().toISOString();
  return {
    asOf,
    providers,
    pulses: [
      buildIntelligencePulse('semiconductors', events, new Date(asOf)),
      buildIntelligencePulse('energy', events, new Date(asOf)),
    ],
    events,
    capitalSignals: events.filter((event) => event.sourceClass === 'capital_signal' || event.sourceClass === 'policy_proxy'),
    policyEvents: events.filter((event) => event.sourceClass === 'primary_source'),
    note: events.length
      ? 'Intelligence is evidence, not a trade instruction. Historical analogs and model interpretation remain subordinate to deterministic portfolio rules.'
      : 'No stored intelligence events yet. Refresh the feed or wait for the scheduled observer; no missing event is treated as neutral evidence.',
  };
}
