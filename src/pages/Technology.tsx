import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { TECHNOLOGY_INTELLIGENCE_SYMBOLS } from '../intelligence/taxonomy.js';
import { formatMoney } from '../core/format.js';

function tone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['Constructive', 'constructive', 'positive'].includes(value)) return 'positive';
  if (['Cautious', 'restrictive', 'negative'].includes(value)) return 'negative';
  if (['Watching', 'mixed'].includes(value)) return 'warning';
  return 'neutral';
}

export function Technology() {
  const intelligence = useResource(() => intelligenceApi.current(), []);
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);

  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!intelligence.data || !portfolio.data) return <LoadingCards count={5} />;

  const p = portfolio.data;
  const pulse = intelligence.data.pulses.find((item) => item.sector === 'technology');
  const events = intelligence.data.events.filter((event) => event.sector === 'technology' || event.sector === 'cross_market');
  const growthCash = p.accounts
    .filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const positions = p.positions.filter((position) => TECHNOLOGY_INTELLIGENCE_SYMBOLS.includes(position.symbol as (typeof TECHNOLOGY_INTELLIGENCE_SYMBOLS)[number]));
  const techSignals = (signals.data?.signals ?? []).filter((row) => TECHNOLOGY_INTELLIGENCE_SYMBOLS.includes(row.symbol as (typeof TECHNOLOGY_INTELLIGENCE_SYMBOLS)[number]));
  const qualified = techSignals.find((row) => row.dip.actionable && row.trend.status === 'TREND_CONFIRMED') ?? null;
  const highImpact = events.find((event) => event.severity === 'high') ?? events[0] ?? null;

  const decision = pulse?.label === 'Cautious'
    ? 'WAIT — policy / market evidence is restrictive'
    : qualified
      ? `MODEL ${qualified.symbol} — price and trend conditions qualify`
      : 'WATCH — no Technology purchase is required now';

  const modelTo = highImpact
    ? `/modeling-lab?event=${encodeURIComponent(highImpact.fingerprint)}&question=${encodeURIComponent('Given the latest Technology intelligence, my current Robinhood growth holdings and available Growth cash, should I add to an existing quality-growth position, initiate a new one, or hold cash?')}`
    : `/modeling-lab?question=${encodeURIComponent('Given my current quality-growth Technology exposure and available Robinhood Growth cash, should I add to an existing position, initiate a new one, or hold cash?')}`;

  return (
    <>
      <PageHead
        eyebrow="Growth · Technology"
        title="Quality growth / Technology"
        lede="Technology is evaluated as a long-horizon growth lane: earnings quality, AI/cloud capex, regulation, valuation and price opportunity must support a move. Research permission is broader than current live broker execution authority."
        action={pulse ? <Badge tone={tone(pulse.label)}>{pulse.label}</Badge> : <Badge tone="neutral">Building evidence</Badge>}
      />

      <div className="grid grid--4 section">
        <Card label="Current decision" title={decision}><p className="meta">A strong company is not automatically a good entry at every price.</p></Card>
        <Card label="Growth Cash Queue" title={formatMoney(growthCash)}><p className="meta">Robinhood Agentic cash can remain idle until a modeled Technology or semiconductor decision qualifies.</p></Card>
        <Card label="Current Technology holdings" title={`${positions.length} position${positions.length === 1 ? '' : 's'}`}><p className="meta">{positions.length ? positions.map((position) => position.symbol).join(' · ') : 'No confirmed Technology/watch-universe position is currently held.'}</p></Card>
        <Card label="Latest evidence" title={highImpact?.headline ?? 'No material Technology event stored'}><p className="meta">{highImpact ? `${highImpact.source} · ${highImpact.eventType}` : 'Missing evidence is not treated as neutral.'}</p></Card>
      </div>

      <Card label="Technology decision engine" title="Quality + valuation + entry + portfolio fit">
        <div className="grid grid--4">
          <div className="panel"><strong>Business quality</strong><p className="meta">Earnings, cloud/AI demand, advertising/e-commerce demand and capital intensity.</p></div>
          <div className="panel"><strong>Policy risk</strong><p className="meta">Antitrust, AI/privacy rules and other regulation that can change the earnings or valuation path.</p></div>
          <div className="panel"><strong>Price setup</strong><p className="meta">Trend health and planned entry zones; price weakness alone is not sufficient.</p></div>
          <div className="panel"><strong>Portfolio overlap</strong><p className="meta">Avoid accidentally duplicating the same AI/mega-cap exposure already present through semiconductor and income holdings.</p></div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn--gold" to={modelTo}>Model the Technology decision</Link>
          <Link className="btn btn--ghost" to="/intelligence">Open Technology intelligence</Link>
          <Link className="btn btn--ghost" to="/portfolio">Open Growth Cash Queue</Link>
        </div>
      </Card>

      <div className="grid grid--2 section">
        <Card label="Price / trend evidence" title="Current research setups">
          {techSignals.length ? (
            <div className="stack stack--tight">
              {techSignals.slice(0, 8).map((row) => (
                <div key={row.symbol}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <strong>{row.symbol}</strong>
                    <Badge tone={row.dip.actionable && row.trend.status === 'TREND_CONFIRMED' ? 'positive' : 'neutral'}>{row.dip.actionable && row.trend.status === 'TREND_CONFIRMED' ? 'Model entry' : 'Watch'}</Badge>
                  </div>
                  <p className="meta">Market health {row.trend.status.replace(/_/g, ' ').toLowerCase()} · buy zone {row.dip.actionable ? 'reached' : 'not reached'}.</p>
                </div>
              ))}
            </div>
          ) : <p className="meta">No Technology symbol currently has enough price-history coverage in the strategy signal engine. Intelligence can still be researched without inventing a trade setup.</p>}
        </Card>

        <Card label="Recent intelligence" title="Technology events">
          {events.length ? (
            <div className="stack stack--tight">
              {events.slice(0, 8).map((event) => (
                <div key={event.fingerprint}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><strong>{event.headline}</strong><Badge tone={tone(event.direction)}>{event.direction}</Badge></div>
                  <p className="meta">{event.source} · {event.eventType} · {event.severity} impact</p>
                </div>
              ))}
            </div>
          ) : <p className="meta">No normalized Technology event is stored yet. DAHCorp will not equate the absence of a headline with a positive signal.</p>}
        </Card>
      </div>

      <Card label="Research universe" title="Quality-growth names the engine may study">
        <div className="tag-list">{TECHNOLOGY_INTELLIGENCE_SYMBOLS.map((symbol) => <Badge key={symbol} tone={positions.some((position) => position.symbol === symbol) ? 'positive' : 'neutral'}>{symbol}</Badge>)}</div>
        <p className="meta" style={{ marginTop: 10 }}>The research universe does not automatically widen Robinhood live execution. A model can recommend a name while the execution step still clearly says “manual / not yet authorized” until the broker allowlist is explicitly expanded.</p>
      </Card>
    </>
  );
}
