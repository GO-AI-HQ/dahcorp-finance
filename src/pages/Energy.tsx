import { Link } from 'react-router-dom';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { ENERGY_INTELLIGENCE_SYMBOLS } from '../intelligence/taxonomy.js';

function tone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['Constructive', 'constructive', 'positive'].includes(value)) return 'positive';
  if (['Cautious', 'restrictive', 'negative'].includes(value)) return 'negative';
  if (['Watching', 'mixed'].includes(value)) return 'warning';
  return 'neutral';
}

export function Energy() {
  const intelligence = useResource(() => intelligenceApi.current(), []);
  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (!intelligence.data) return <LoadingCards count={4} />;

  const pulse = intelligence.data.pulses.find((item) => item.sector === 'energy');
  const energyEvents = intelligence.data.events.filter((event) => event.sector === 'energy' || event.sector === 'cross_market');
  const highImpact = energyEvents.find((event) => event.severity === 'high');
  const decision = pulse?.label === 'Constructive'
    ? 'WATCH FOR QUALIFIED ENTRY'
    : pulse?.label === 'Cautious'
      ? 'HOLD CASH / REVIEW RISK'
      : 'WAIT / WATCH';

  return (
    <>
      <PageHead
        eyebrow="Growth · Energy"
        title="Energy growth"
        lede="Energy and nuclear opportunities are evaluated against policy, supply, demand and market evidence before they become a portfolio recommendation."
        action={pulse ? <Badge tone={tone(pulse.label)}>{pulse.label}</Badge> : undefined}
      />

      <div className="grid grid--3 section">
        <Card label="Current decision" title={decision}>
          <p className="meta">
            Energy intelligence is live as an evidence lane, but no Energy symbol is added to Robinhood execution authority merely because it appears here.
          </p>
          <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <Link to="/intelligence" className="btn btn--sm btn--ghost">View intelligence</Link>
            <Link to="/strategy-lab" className="btn btn--sm btn--ghost">Strategy Lab</Link>
          </div>
        </Card>

        <Card label="Energy watch universe" title="What the engine is studying">
          <div className="tag-list">
            {ENERGY_INTELLIGENCE_SYMBOLS.map((symbol) => <Badge key={symbol} tone="neutral">{symbol}</Badge>)}
          </div>
          <p className="meta" style={{ marginTop: 10 }}>CCJ is Cameco. Watch status is research permission, not trade permission.</p>
        </Card>

        <Card label="Latest high-impact evidence" title={highImpact ? highImpact.headline : 'No high-impact event stored'}>
          {highImpact ? (
            <>
              <p className="meta">{highImpact.summary || highImpact.source}</p>
              <p className="meta">DAHCorp response: evidence changed; deterministic entry rules still decide whether capital moves.</p>
            </>
          ) : <p className="meta">The absence of a stored high-impact event is not treated as proof that policy risk is neutral.</p>}
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Policy + supply" title="What matters for Energy">
          <ul className="bullets">
            <li>Nuclear policy, NRC actions and uranium supply.</li>
            <li>FERC approvals, grid investment and transmission capacity.</li>
            <li>EIA inventories, OPEC production policy and LNG capacity.</li>
            <li>Sanctions, trade restrictions and geopolitical supply disruption.</li>
            <li>Data-center and electricity-demand growth.</li>
          </ul>
        </Card>

        <Card label="Recent evidence" title="Energy events">
          {energyEvents.length ? (
            <div className="stack stack--tight">
              {energyEvents.slice(0, 8).map((event) => (
                <div key={event.fingerprint}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                    <strong>{event.headline}</strong>
                    <Badge tone={tone(event.direction)}>{event.direction}</Badge>
                  </div>
                  <p className="meta">{event.source} · {event.eventType}</p>
                </div>
              ))}
            </div>
          ) : <p className="meta">No normalized Energy events are stored yet. The hourly intelligence observer will populate this surface as evidence arrives.</p>}
        </Card>
      </div>
    </>
  );
}
