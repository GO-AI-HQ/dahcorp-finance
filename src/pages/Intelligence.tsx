import { useState } from 'react';
import { Link } from 'react-router-dom';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { formatMoney, formatPct } from '../core/format.js';
import type { HistoricalRelevance, IntelligenceEvent, IntelligencePulse, IntelligenceSector } from '../intelligence/types.js';

function badgeTone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' | 'intel' {
  if (['Constructive', 'positive', 'constructive'].includes(value)) return 'positive';
  if (['Cautious', 'negative', 'restrictive'].includes(value)) return 'negative';
  if (['Watching', 'mixed'].includes(value)) return 'warning';
  return 'neutral';
}

const SECTOR_NAME: Record<Exclude<IntelligenceSector, 'cross_market'>, string> = {
  semiconductors: 'Semiconductors',
  energy: 'Energy',
  shipping: 'Shipping',
  technology: 'Technology',
};

function strategyMeaning(pulse: IntelligencePulse): string {
  if (pulse.sector === 'shipping') {
    if (pulse.label === 'Constructive') return 'Evidence is improving for the Schwab Maritime strategy. Keep looking for holdings whose price still offers a sensible entry.';
    if (pulse.label === 'Cautious') return 'Shipping evidence is working against new IRA accumulation. Preserve Maritime cash until rates/market health improve.';
    return 'No shipping evidence is strong enough to change the Maritime accumulation plan yet.';
  }
  if (pulse.sector === 'technology') {
    if (pulse.label === 'Constructive') return 'The backdrop supports quality-growth accumulation, but price still has to justify adding to GOOGL/AMZN/WMT or another approved core holding.';
    if (pulse.label === 'Cautious') return 'The backdrop argues for slower technology DCA and more cash patience.';
    return 'Technology evidence does not currently justify changing the DCA plan.';
  }
  if (pulse.sector === 'energy') {
    if (pulse.label === 'Constructive') return 'Energy/nuclear evidence is improving. DAHCorp should look for a qualified CCJ/energy entry rather than buy simply because news is positive.';
    if (pulse.label === 'Cautious') return 'Energy evidence argues for preserving capital until the opportunity becomes cheaper or stronger.';
    return 'Energy evidence is not strong enough to change the current plan.';
  }
  if (pulse.label === 'Constructive') return 'The semiconductor backdrop is improving. It can strengthen a SEMI/core entry only when price and market-health rules also qualify.';
  if (pulse.label === 'Cautious') return 'The semiconductor backdrop increases downside risk. Preserve Growth cash rather than force a chip purchase.';
  return 'The semiconductor backdrop does not currently justify changing the Growth plan by itself.';
}

function PulseCard({ pulse }: { pulse: IntelligencePulse }) {
  return (
    <Card
      label="Sector pulse"
      title={SECTOR_NAME[pulse.sector]}
      action={<Badge tone={badgeTone(pulse.label)} glyph={pulse.score > 0 ? '▲' : pulse.score < 0 ? '▼' : '→'}>{pulse.label}</Badge>}
    >
      <div className="stack stack--tight">
        <div className="key-value"><span className="soft">Market</span><strong>{pulse.market}</strong></div>
        <div className="key-value"><span className="soft">Policy</span><strong>{pulse.policy}</strong></div>
        <div className="key-value"><span className="soft">News</span><strong>{pulse.newsPressure}</strong></div>
        <div className="key-value"><span className="soft">Capital signals</span><strong>{pulse.capitalSignals}</strong></div>
        <p>{strategyMeaning(pulse)}</p>
        <p className="meta">{pulse.eventCount} relevant evidence items · {pulse.highImpactCount} high-impact. The score is evidence balance, not probability of profit.</p>
      </div>
    </Card>
  );
}

function latencyLabel(event: IntelligenceEvent): string {
  if (event.latency === 'real_time') return 'Real-time';
  if (event.latency === 'near_real_time') return 'Near real-time';
  if (event.latency === 'delayed_disclosure') return 'Delayed disclosure';
  if (event.latency === 'retrospective') return 'Retrospective';
  return 'Timing unknown';
}

function strategyView(event: IntelligenceEvent): string {
  const adverse = event.direction === 'restrictive';
  const supportive = event.direction === 'constructive';
  if (event.sector === 'shipping') {
    if (adverse) return 'This could weaken freight economics or increase disruption risk. For the Schwab Maritime strategy, that means avoid adding merely because a shipping stock looks cheaper; wait for rates and company/market evidence to support the entry.';
    if (supportive) return 'This could improve freight economics or vessel earnings. It strengthens the case for Maritime accumulation only when the target stock is also attractively priced.';
    return 'This matters to the Maritime strategy, but the evidence is not directional enough to justify changing the IRA allocation on its own.';
  }
  if (event.sector === 'energy') {
    if (adverse) return 'This may reduce earnings or valuation support for the Energy/Nuclear lane. Preserve capital until price and market health offer a better risk/reward entry.';
    if (supportive) return 'This may improve the earnings/demand backdrop for Energy/Nuclear holdings. It can strengthen a CCJ/energy entry but does not create one by itself.';
    return 'This changes the Energy evidence set, but not enough to change the allocation plan by itself.';
  }
  if (event.sector === 'technology') {
    if (adverse) return 'This could weaken the long-term earnings or valuation setup for quality technology holdings. Slow new DCA until the price compensates for the added risk.';
    if (supportive) return 'This can improve the long-term earnings backdrop for quality-growth holdings. DAHCorp should still add only at a price that improves the plan.';
    return 'This is relevant to quality-growth holdings, but it does not currently change the DCA plan by itself.';
  }
  if (adverse) return 'This increases the chance that semiconductor holdings face more downside or volatility. Our Growth strategy benefits by keeping cash available until the sector offers a stronger entry rather than buying into worsening evidence.';
  if (supportive) return 'This improves the backdrop for semiconductor demand or policy. It strengthens a staged SEMI/core purchase only if price and trend conditions also qualify.';
  return 'This is relevant to the chip strategy, but it does not yet justify moving Growth cash.';
}

function actionForEvent(event: IntelligenceEvent): { title: string; detail: string } {
  if (event.direction === 'restrictive' && (event.severity === 'high' || event.severity === 'medium')) {
    return { title: 'WAIT / PRESERVE CASH', detail: 'Do not add because of this event. Keep the relevant Cash Queue available for a better entry or clearer evidence.' };
  }
  if (event.direction === 'constructive' && event.severity !== 'info') {
    return { title: 'WATCH FOR A QUALIFIED BUY', detail: 'This improves the evidence, but DAHCorp still needs an attractive price, the correct account cash, and deterministic approval before buying.' };
  }
  return { title: 'HOLD THE CURRENT PLAN', detail: 'The event is worth remembering, but it is not strong enough to change capital allocation by itself.' };
}

function PolicyRadar({ events }: { events: IntelligenceEvent[] }) {
  const policy = events.filter((event) => event.sourceClass === 'primary_source' || event.sourceClass === 'policy_proxy').slice(0, 10);
  return (
    <Card label="Policy Radar" title="What policy means for the plan">
      {policy.length ? (
        <div className="stack stack--tight">
          {policy.map((event) => (
            <div key={event.fingerprint} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>{event.sector === 'cross_market' ? 'Cross-market' : SECTOR_NAME[event.sector]}</strong>
                <Badge tone={badgeTone(event.direction)}>{event.direction}</Badge>
              </div>
              <p className="meta">{event.headline}</p>
              <p>{strategyView(event)}</p>
            </div>
          ))}
        </div>
      ) : <p className="meta">No strategy-relevant policy record is stored yet.</p>}
    </Card>
  );
}

function HistoricalPanel({ result }: { result: HistoricalRelevance }) {
  const line = (label: string, row: HistoricalRelevance['oneDay']) => (
    <div className="key-value">
      <span>{label}</span>
      <strong>{row.count ? `${formatPct(row.median ?? 0, 1)} median · ${formatPct(row.min ?? 0, 1)} to ${formatPct(row.max ?? 0, 1)} · n=${row.count}` : 'Not enough elapsed history yet'}</strong>
    </div>
  );
  return (
    <div className="banner banner--intel" style={{ marginTop: 10 }}>
      <div style={{ width: '100%' }}>
        <strong>Historical Relevance</strong>
        <p className="meta">{result.summary}</p>
        {line('1 trading day', result.oneDay)}
        {line('5 trading days', result.fiveDay)}
        {line('20 trading days', result.twentyDay)}
        <p className="meta">These are observed outcomes for comparable stored events, not odds that the current event will repeat them.</p>
      </div>
    </div>
  );
}

function CapitalSignals({ events }: { events: IntelligenceEvent[] }) {
  return (
    <Card label="Capital Signals" title="What public money-movement disclosures are saying">
      {events.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Signal</th><th>Asset</th><th>Direction</th><th>Timing</th><th>Strategic use</th></tr></thead>
            <tbody>
              {events.slice(0, 14).map((event) => (
                <tr key={event.fingerprint}>
                  <th>{event.headline}</th>
                  <td>{event.symbols.join(', ') || '—'}</td>
                  <td><Badge tone={badgeTone(event.direction)}>{event.direction}</Badge></td>
                  <td>{latencyLabel(event)}{typeof event.metadata?.reportingGap === 'string' ? ` · ${event.metadata.reportingGap}` : ''}</td>
                  <td>{event.latency === 'retrospective' || event.latency === 'delayed_disclosure' ? 'Context only — compare with current price and other evidence.' : 'Evidence input — still requires portfolio/risk confirmation.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="meta">No strategy-relevant congressional, lobbying or institutional signal is stored yet.</p>}
    </Card>
  );
}

export function Intelligence() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [historicalFor, setHistoricalFor] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalRelevance | null>(null);
  const [historicalBusy, setHistoricalBusy] = useState(false);
  const intelligence = useResource(() => refreshToken ? intelligenceApi.refresh() : intelligenceApi.current(), [refreshToken]);
  const portfolio = useResource(() => api.portfolio(), []);

  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (!intelligence.data || !portfolio.data) return <LoadingCards count={6} />;
  const data = intelligence.data;
  const p = portfolio.data;
  const growthCash = p.accounts.filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible).reduce((sum, row) => sum + row.cash, 0);
  const important = data.events.filter((event) => event.severity === 'high' || event.severity === 'medium').slice(0, 8);

  async function openHistory(event: IntelligenceEvent) {
    if (historicalFor === event.fingerprint) {
      setHistoricalFor(null);
      setHistorical(null);
      return;
    }
    setHistoricalFor(event.fingerprint);
    setHistoricalBusy(true);
    setHistorical(null);
    try { setHistorical(await intelligenceApi.historicalRelevance(event.eventType, event.sector)); }
    finally { setHistoricalBusy(false); }
  }

  return (
    <>
      <PageHead
        eyebrow="Market Intelligence"
        title="What changed — and does it change the plan?"
        lede="DAHCorp filters policy, market news and public positioning through your actual strategies. If an event does not materially affect a goal, holding, Cash Queue or planned action, it does not deserve the primary screen."
        action={<button type="button" className="btn btn--sm btn--ghost" disabled={intelligence.refreshing} onClick={() => setRefreshToken((value) => value + 1)}>{intelligence.refreshing ? 'Refreshing…' : 'Refresh intelligence'}</button>}
      />

      <div className="grid grid--4 section">
        {data.pulses.map((pulse) => <PulseCard key={pulse.sector} pulse={pulse} />)}
      </div>

      <div className="grid grid--wide-left section">
        <Card label="Today's important events" title="Only intelligence that can matter to the strategy">
          {important.length ? (
            <div className="stack">
              {important.map((event) => {
                const action = actionForEvent(event);
                return (
                  <div key={event.fingerprint} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 18 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone={event.severity === 'high' ? 'negative' : 'warning'}>{event.severity.toUpperCase()} IMPACT</Badge>
                      <Badge tone="neutral">{latencyLabel(event)}</Badge>
                      <Badge tone="intel">{event.sourceClass === 'primary_source' ? 'PRIMARY SOURCE' : event.sourceClass === 'analyst_commentary' ? 'ANALYST EVIDENCE' : 'MARKET SOURCE'}</Badge>
                    </div>
                    <h3 style={{ marginTop: 10 }}>{event.headline}</h3>
                    <p className="meta">{event.source} · {event.sector === 'cross_market' ? 'Cross-market' : SECTOR_NAME[event.sector]}</p>
                    {event.symbols.length ? <p><strong>Affected:</strong> {event.symbols.join(' · ')}</p> : null}

                    <p className="card__label" style={{ marginTop: 12 }}><span>DAHCorp Strategic View</span></p>
                    <p>{strategyView(event)}</p>

                    <div className="banner" style={{ marginTop: 10 }}>
                      <div>
                        <strong>ACTION — {action.title}</strong>
                        <p className="meta">{action.detail}{event.sector === 'semiconductors' && action.title.includes('CASH') ? ` Growth cash currently available: ${formatMoney(growthCash)}.` : ''}</p>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setWhyOpen(whyOpen === event.fingerprint ? null : event.fingerprint)}>Why?</button>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => openHistory(event)}>Historical Relevance</button>
                      <Link className="btn btn--sm btn--gold" to={`/strategy-lab?event=${encodeURIComponent(event.fingerprint)}&sector=${encodeURIComponent(event.sector)}&eventType=${encodeURIComponent(event.eventType)}`}>Model Impact</Link>
                      {event.sourceUrl ? <a className="btn btn--sm btn--ghost" href={event.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}
                    </div>
                    {whyOpen === event.fingerprint ? (
                      <div className="panel" style={{ marginTop: 10 }}>
                        <strong>Why this supports the goal</strong>
                        <p>{action.title.startsWith('WAIT') ? 'Preserving capital is an active decision: it keeps buying power available for a price where the expected reward better compensates for the risk.' : action.title.startsWith('WATCH') ? 'This event improves one piece of the thesis, but buying before price, cash and risk rules align would turn intelligence into speculation.' : 'The best action is to keep the existing strategy unchanged until this evidence becomes stronger or is confirmed by price/portfolio conditions.'}</p>
                      </div>
                    ) : null}
                    {historicalFor === event.fingerprint ? historicalBusy ? <p className="meta">Loading DAHCorp event history…</p> : historical ? <HistoricalPanel result={historical} /> : null : null}
                  </div>
                );
              })}
            </div>
          ) : <p className="meta">No material event is currently strong enough to deserve an action card.</p>}
        </Card>

        <PolicyRadar events={data.events} />
      </div>

      <div className="section"><CapitalSignals events={data.capitalSignals} /></div>

      <details className="section">
        <summary className="btn btn--ghost">View intelligence data sources and provider status</summary>
        <div className="grid grid--3" style={{ marginTop: 14 }}>
          {data.providers.map((provider) => (
            <div key={provider.provider} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><strong>{provider.provider.replace(/_/g, ' ')}</strong><Badge tone={provider.status === 'live' ? 'positive' : provider.status === 'partial' ? 'warning' : 'neutral'}>{provider.status}</Badge></div>
              <p className="meta">{provider.note}</p>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
