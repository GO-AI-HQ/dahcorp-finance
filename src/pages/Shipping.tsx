import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { SHIPPING_INTELLIGENCE_SYMBOLS } from '../intelligence/taxonomy.js';
import { formatMoney } from '../core/format.js';

function tone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['Constructive', 'constructive', 'positive'].includes(value)) return 'positive';
  if (['Cautious', 'restrictive', 'negative'].includes(value)) return 'negative';
  if (['Watching', 'mixed'].includes(value)) return 'warning';
  return 'neutral';
}

export function Shipping() {
  const intelligence = useResource(() => intelligenceApi.current(), []);
  const portfolio = useResource(() => api.portfolio(), []);

  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!intelligence.data || !portfolio.data) return <LoadingCards count={5} />;

  const p = portfolio.data;
  const pulse = intelligence.data.pulses.find((item) => item.sector === 'shipping');
  const events = intelligence.data.events.filter((event) => event.sector === 'shipping' || event.sector === 'cross_market');
  const specialistEvidence = events.filter((event) => event.sourceClass === 'analyst_commentary');
  const marketEvidence = events.filter((event) => event.sourceClass !== 'analyst_commentary');
  const highImpact = marketEvidence.find((event) => event.severity === 'high') ?? marketEvidence[0] ?? specialistEvidence[0] ?? null;
  const maritimeAccounts = p.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Maritime'));
  const maritimeCash = maritimeAccounts.reduce((sum, row) => sum + row.cash, 0);
  const maritimeIds = new Set(maritimeAccounts.map((row) => row.account.id));
  const positions = p.positions.filter((position) => maritimeIds.has(position.accountId) || position.sleeve === 'shipping_cyclical');

  const decision = pulse?.label === 'Constructive'
    ? 'WATCH FOR QUALIFIED SHIPPING ADD'
    : pulse?.label === 'Cautious'
      ? 'HOLD / PRESERVE MARITIME CASH'
      : 'WAIT / WATCH THE CYCLE';

  const modelTo = highImpact
    ? `/modeling-lab?event=${encodeURIComponent(highImpact.fingerprint)}&question=${encodeURIComponent('Given the current shipping cycle, freight/vessel evidence, specialist commentary and my Maritime holdings, should I add to an existing shipping position, rotate among shipping names, or hold Maritime cash?')}`
    : `/modeling-lab?question=${encodeURIComponent('Given my current Maritime holdings and available shipping cash, should I add to an existing shipping position, rotate among shipping names, or hold cash?')}`;

  return (
    <>
      <PageHead
        eyebrow="Growth · Shipping"
        title="Maritime / Shipping"
        lede="Shipping is treated as a cyclical specialist strategy. Freight rates, vessel supply, orderbooks, rerouting, sanctions and specialist commentary are reconciled before DAHCorp proposes a move. Commentary alone is never a trade trigger."
        action={pulse ? <Badge tone={tone(pulse.label)}>{pulse.label}</Badge> : <Badge tone="neutral">Building evidence</Badge>}
      />

      <div className="grid grid--4 section">
        <Card label="Current decision" title={decision}><p className="meta">The cycle can change quickly; DAHCorp prefers explicit entry/rotation logic over permanent buy-and-hold assumptions.</p></Card>
        <Card label="Maritime Cash Queue" title={formatMoney(maritimeCash)}><p className="meta">Schwab cash explicitly attached to the Maritime mandate. It is separate from Income account 3085.</p></Card>
        <Card label="Shipping holdings" title={`${positions.length} position${positions.length === 1 ? '' : 's'}`}><p className="meta">{positions.length ? positions.map((position) => position.symbol).join(' · ') : 'No confirmed shipping position is currently attached to the Maritime mandate.'}</p></Card>
        <Card label="Evidence mix" title={`${marketEvidence.length} market/policy · ${specialistEvidence.length} specialist`}><p className="meta">Specialist views are useful because shipping is niche, but higher-authority market/policy evidence must corroborate an actionable conclusion.</p></Card>
      </div>

      <Card label="Maritime decision engine" title="What would make a Shipping move actionable?">
        <div className="grid grid--3">
          <div className="panel"><strong>1 · Cycle evidence</strong><p className="meta">Freight/charter rates, ton-mile demand, fleet growth, scrapping and orderbook constraints.</p></div>
          <div className="panel"><strong>2 · Disruption / policy</strong><p className="meta">Suez, Red Sea, Hormuz, sanctions, port fees, trade restrictions and rerouting.</p></div>
          <div className="panel"><strong>3 · Portfolio fit</strong><p className="meta">Existing INSW/DAC/GSL-style exposure, available Maritime cash, concentration and whether another name materially improves the cycle exposure.</p></div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn--gold" to={modelTo}>Model the Shipping decision</Link>
          <Link className="btn btn--ghost" to="/intelligence">Open Shipping intelligence</Link>
          <Link className="btn btn--ghost" to="/portfolio">Open Maritime account</Link>
        </div>
      </Card>

      <div className="grid grid--2 section">
        <Card label="Specialist commentary" title="What niche shipping analysts are saying">
          {specialistEvidence.length ? (
            <div className="stack stack--tight">
              {specialistEvidence.slice(0, 8).map((event) => (
                <div key={event.fingerprint}>
                  <strong>{event.headline}</strong>
                  <p className="meta">{event.source} · Analyst Evidence · {event.direction}</p>
                  {event.summary ? <p className="meta">{event.summary}</p> : null}
                </div>
              ))}
            </div>
          ) : <p className="meta">No recent specialist-feed item is stored yet. Public feeds are probed during intelligence refresh; missing commentary is not interpreted as neutral.</p>}
        </Card>

        <Card label="Market + policy evidence" title="What can corroborate or contradict the commentary">
          {marketEvidence.length ? (
            <div className="stack stack--tight">
              {marketEvidence.slice(0, 8).map((event) => (
                <div key={event.fingerprint}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <strong>{event.headline}</strong>
                    <Badge tone={tone(event.direction)}>{event.direction}</Badge>
                  </div>
                  <p className="meta">{event.source} · {event.eventType} · {event.severity} impact</p>
                </div>
              ))}
            </div>
          ) : <p className="meta">No corroborating market/policy event is stored yet. DAHCorp will not promote analyst commentary to an actionable trade without additional evidence.</p>}
        </Card>
      </div>

      <Card label="Research universe" title="Names the Shipping engine may study">
        <div className="tag-list">{SHIPPING_INTELLIGENCE_SYMBOLS.map((symbol) => <Badge key={symbol} tone={positions.some((position) => position.symbol === symbol) ? 'positive' : 'neutral'}>{symbol}</Badge>)}</div>
        <p className="meta" style={{ marginTop: 10 }}>Research permission does not create broker execution authority. A modeled recommendation must still identify the correct Schwab Maritime account and execution path.</p>
      </Card>
    </>
  );
}
