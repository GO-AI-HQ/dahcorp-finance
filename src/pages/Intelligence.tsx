import { useState } from 'react';
import { Link } from 'react-router-dom';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import type { IntelligenceEvent, IntelligencePulse } from '../intelligence/types.js';

function badgeTone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' | 'intel' {
  if (['Constructive', 'positive', 'constructive'].includes(value)) return 'positive';
  if (['Cautious', 'negative', 'restrictive'].includes(value)) return 'negative';
  if (['Watching', 'mixed'].includes(value)) return 'warning';
  return 'neutral';
}

function PulseCard({ pulse }: { pulse: IntelligencePulse }) {
  const title = pulse.sector === 'semiconductors' ? 'Semiconductors' : 'Energy';
  return (
    <Card
      label="Sector pulse"
      title={title}
      action={<Badge tone={badgeTone(pulse.label)} glyph={pulse.score > 0 ? '▲' : pulse.score < 0 ? '▼' : '→'}>{pulse.label}</Badge>}
    >
      <div className="stack stack--tight">
        <div className="key-value"><span className="soft">Market</span><strong>{pulse.market}</strong></div>
        <div className="key-value"><span className="soft">Policy</span><strong>{pulse.policy}</strong></div>
        <div className="key-value"><span className="soft">News pressure</span><strong>{pulse.newsPressure}</strong></div>
        <div className="key-value"><span className="soft">Capital signals</span><strong>{pulse.capitalSignals}</strong></div>
        <p className="meta">{pulse.eventCount} recent evidence items · {pulse.highImpactCount} high-impact. Score {pulse.score} is an evidence balance, not a probability of market direction.</p>
      </div>
    </Card>
  );
}

function latencyLabel(event: IntelligenceEvent): string {
  if (event.latency === 'real_time') return 'Real-time';
  if (event.latency === 'near_real_time') return 'Near real-time';
  if (event.latency === 'delayed_disclosure') return 'Delayed disclosure';
  if (event.latency === 'retrospective') return 'Retrospective';
  return 'Latency unknown';
}

function DecisionForEvent({ event }: { event: IntelligenceEvent }) {
  const decision = event.direction === 'restrictive' && event.severity === 'high'
    ? 'PRESERVE CASH / REVIEW'
    : event.direction === 'constructive' && event.severity !== 'info'
      ? 'WATCH FOR QUALIFIED ENTRY'
      : 'NO AUTOMATIC ACTION';
  return (
    <div className="stack stack--tight">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={event.severity === 'high' ? 'negative' : event.severity === 'medium' ? 'warning' : 'neutral'}>{event.severity} impact</Badge>
        <Badge tone="neutral">{latencyLabel(event)}</Badge>
        <Badge tone={badgeTone(event.direction)}>{event.direction}</Badge>
      </div>
      <p><strong>{event.headline}</strong></p>
      {event.summary ? <p className="meta">{event.summary}</p> : null}
      <p className="meta">{event.source} · {event.sector === 'cross_market' ? 'Cross-market' : event.sector} · {event.eventType}</p>
      {event.symbols.length ? <p className="meta">Affected / referenced: {event.symbols.join(' · ')}</p> : null}
      <div className="banner" style={{ marginTop: 6 }}>
        <strong>DAHCorp response: {decision}</strong>
        <p className="meta" style={{ marginTop: 4 }}>
          This event changes evidence, not execution authority. Growth/Income rules and the deterministic policy engine still decide whether capital may move.
        </p>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Link className="btn btn--sm btn--ghost" to="/growth">Growth impact</Link>
        <Link className="btn btn--sm btn--ghost" to="/strategy-lab">Strategy Lab</Link>
        {event.sourceUrl ? <a className="btn btn--sm btn--ghost" href={event.sourceUrl} target="_blank" rel="noreferrer">Primary/source record</a> : null}
      </div>
    </div>
  );
}

export function Intelligence() {
  const [refreshToken, setRefreshToken] = useState(0);
  const intelligence = useResource(
    () => refreshToken ? intelligenceApi.refresh() : intelligenceApi.current(),
    [refreshToken],
  );

  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (!intelligence.data) return <LoadingCards count={6} />;
  const data = intelligence.data;

  return (
    <>
      <PageHead
        eyebrow="Market Intelligence"
        title="What changed — and does it matter to your money?"
        lede="DAHCorp combines primary policy records, fast market events and public capital disclosures, then translates them into portfolio evidence. Public information is not a trade instruction."
        action={
          <button type="button" className="btn btn--sm btn--ghost" disabled={intelligence.refreshing} onClick={() => setRefreshToken((value) => value + 1)}>
            {intelligence.refreshing ? 'Refreshing…' : 'Refresh intelligence'}
          </button>
        }
      />

      <div className="grid grid--2 section">
        {data.pulses.map((pulse) => <PulseCard key={pulse.sector} pulse={pulse} />)}
      </div>

      <Card label="Data lanes" title="What is feeding the intelligence layer" tight>
        <div className="grid grid--3">
          {data.providers.map((provider) => (
            <div key={provider.provider} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>{provider.provider === 'finnhub' ? 'Finnhub' : provider.provider === 'openbb' ? 'OpenBB REST' : 'Primary policy'}</strong>
                <Badge tone={provider.status === 'live' ? 'positive' : provider.status === 'partial' ? 'warning' : 'neutral'}>{provider.status}</Badge>
              </div>
              <p className="meta" style={{ marginTop: 8 }}>{provider.note}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid--wide-left section">
        <Card label="Live evidence" title="Important events">
          {data.events.length ? (
            <div className="stack">
              {data.events.slice(0, 12).map((event) => <DecisionForEvent key={event.fingerprint} event={event} />)}
            </div>
          ) : (
            <p className="meta">No normalized events have been stored yet. Refresh the feed or wait for the hourly observer. Missing evidence is never silently treated as neutral evidence.</p>
          )}
        </Card>

        <Card label="Capital Signals" title="Public positioning evidence">
          {data.capitalSignals.length ? (
            <div className="stack stack--tight">
              {data.capitalSignals.slice(0, 8).map((event) => (
                <div key={event.fingerprint}>
                  <strong>{event.symbols.join(', ') || event.headline}</strong>
                  <p className="meta">{event.headline}</p>
                  <p className="meta">{latencyLabel(event)} · context only unless other evidence and policy gates align.</p>
                </div>
              ))}
            </div>
          ) : <p className="meta">No recent congressional/lobbying/institutional signals are stored yet.</p>}
        </Card>
      </div>

      <Card label="Policy radar" title="Primary-source evidence">
        {data.policyEvents.length ? (
          <div className="stack stack--tight">
            {data.policyEvents.slice(0, 10).map((event) => (
              <div key={event.fingerprint} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
                <div>
                  <strong>{event.headline}</strong>
                  <p className="meta">{event.source} · {event.eventType}</p>
                </div>
                <Badge tone={badgeTone(event.direction)}>{event.direction}</Badge>
              </div>
            ))}
          </div>
        ) : <p className="meta">No primary-policy events stored yet.</p>}
        <p className="meta" style={{ marginTop: 12 }}>{data.note}</p>
      </Card>
    </>
  );
}
