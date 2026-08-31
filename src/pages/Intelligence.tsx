import { useState } from 'react';
import { Link } from 'react-router-dom';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { MarketPulseTicker } from '../components/MarketPulseTicker.js';
import { GovernmentTradingTicker } from '../components/GovernmentTradingTicker.js';
import { AssetDecisionTranslator } from '../components/AssetDecisionTranslator.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { formatMoney, formatPct } from '../core/format.js';
import type { HistoricalRelevance, IntelligenceEvent, IntelligencePulse, IntelligenceSector } from '../intelligence/types.js';

function badgeTone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' | 'intel' {
  if (['Constructive', 'positive', 'constructive', 'live', 'working', 'verified'].includes(value)) return 'positive';
  if (['Cautious', 'negative', 'restrictive', 'blocked', 'unavailable'].includes(value)) return 'negative';
  if (['Watching', 'mixed', 'partial', 'warning', 'stale'].includes(value)) return 'warning';
  return 'neutral';
}

const SECTOR_NAME: Record<Exclude<IntelligenceSector, 'cross_market'>, string> = {
  semiconductors: 'Semiconductors',
  energy: 'Energy',
  shipping: 'Shipping',
  technology: 'Technology',
};

const LANE_NAME: Record<string, string> = {
  options: 'Options positioning',
  fund_lookthrough: 'What funds actually own',
  maritime: 'Shipping and port activity',
  energy_positioning: 'Energy supply and positioning',
  filings_insiders: 'Company filings and insider activity',
  earnings: 'Earnings results',
  crowding: 'Short interest and crowded trades',
  government_capital: 'Government and public money moves',
};

function strategyMeaning(pulse: IntelligencePulse): string {
  if (pulse.sector === 'shipping') {
    if (pulse.label === 'Constructive') return 'Shipping conditions are improving. Keep looking for a good entry rather than buying simply because the backdrop is better.';
    if (pulse.label === 'Cautious') return 'Shipping conditions are working against new purchases right now. Keep Maritime cash available until the evidence improves.';
    return 'Nothing in shipping is strong enough to change the plan yet.';
  }
  if (pulse.sector === 'technology') {
    if (pulse.label === 'Constructive') return 'The backdrop supports quality growth, but price still has to justify adding to GOOGL, AMZN, WMT or another approved holding.';
    if (pulse.label === 'Cautious') return 'The backdrop argues for slower technology buying and more patience with cash.';
    return 'Technology conditions do not currently justify changing the plan.';
  }
  if (pulse.sector === 'energy') {
    if (pulse.label === 'Constructive') return 'Energy and nuclear conditions are improving. Look for a good CCJ or energy entry rather than buying just because the news is positive.';
    if (pulse.label === 'Cautious') return 'Energy conditions argue for keeping cash available until the opportunity becomes cheaper or stronger.';
    return 'Energy conditions are not strong enough to change the plan.';
  }
  if (pulse.label === 'Constructive') return 'The semiconductor backdrop is improving. It can strengthen a SEMI or core-chip purchase only when the price also makes sense.';
  if (pulse.label === 'Cautious') return 'The semiconductor backdrop is adding downside risk. Keeping Growth cash available is better than forcing a chip purchase.';
  return 'The semiconductor backdrop does not currently justify changing the Growth plan by itself.';
}

function PulseCard({ pulse }: { pulse: IntelligencePulse }) {
  return (
    <Card
      label="Sector check"
      title={SECTOR_NAME[pulse.sector]}
      action={<Badge tone={badgeTone(pulse.label)} glyph={pulse.score > 0 ? '▲' : pulse.score < 0 ? '▼' : '→'}>{pulse.label}</Badge>}
    >
      <div className="stack stack--tight">
        <div className="key-value"><span className="soft">Market</span><strong>{pulse.market}</strong></div>
        <div className="key-value"><span className="soft">Policy</span><strong>{pulse.policy}</strong></div>
        <div className="key-value"><span className="soft">News</span><strong>{pulse.newsPressure}</strong></div>
        <div className="key-value"><span className="soft">Public money moves</span><strong>{pulse.capitalSignals}</strong></div>
        <p>{strategyMeaning(pulse)}</p>
        <p className="meta">{pulse.eventCount} relevant items · {pulse.highImpactCount} high-impact. This is a balance of evidence, not a prediction of profit.</p>
      </div>
    </Card>
  );
}

function latencyLabel(event: IntelligenceEvent): string {
  if (event.latency === 'real_time') return 'Real-time';
  if (event.latency === 'near_real_time') return 'Near real-time';
  if (event.latency === 'delayed_disclosure') return 'Reported later';
  if (event.latency === 'retrospective') return 'Historical';
  return 'Timing unknown';
}

function strategyView(event: IntelligenceEvent): string {
  const adverse = event.direction === 'restrictive';
  const supportive = event.direction === 'constructive';
  if (event.sector === 'shipping') {
    if (adverse) return 'This could hurt freight economics or increase disruption risk. That is a reason to wait for better price and market evidence before adding to Shipping.';
    if (supportive) return 'This could improve freight economics or vessel earnings. It strengthens the case for Shipping only when the target stock is also attractively priced.';
    return 'This matters to Shipping, but it is not directional enough to change the allocation by itself.';
  }
  if (event.sector === 'energy') {
    if (adverse) return 'This may weaken the earnings or valuation backdrop for Energy and Nuclear. Keep capital available until price and market conditions improve.';
    if (supportive) return 'This may improve the earnings or demand backdrop for Energy and Nuclear. It can strengthen a CCJ or energy purchase but does not create one by itself.';
    return 'This changes the Energy picture, but not enough to change the plan by itself.';
  }
  if (event.sector === 'technology') {
    if (adverse) return 'This could weaken the long-term setup for quality technology holdings. Slow new buying until the price better compensates for the added risk.';
    if (supportive) return 'This can improve the long-term earnings backdrop for quality growth. Add only when the price still improves the plan.';
    return 'This matters to quality growth, but it does not currently change the buying plan by itself.';
  }
  if (adverse) return 'This raises the chance of more downside or volatility in semiconductors. Keeping Growth cash available can be more valuable than buying into worsening conditions.';
  if (supportive) return 'This improves the semiconductor backdrop. It strengthens a staged purchase only if price and trend conditions also line up.';
  return 'This is relevant to the chip strategy, but it does not yet justify moving Growth cash.';
}

function actionForEvent(event: IntelligenceEvent): { title: string; detail: string } {
  if (event.direction === 'restrictive' && (event.severity === 'high' || event.severity === 'medium')) {
    return { title: 'WAIT AND KEEP CASH AVAILABLE', detail: 'Do not add because of this event. Keep the relevant cash available for a better entry or clearer evidence.' };
  }
  if (event.direction === 'constructive' && event.severity !== 'info') {
    return { title: 'WATCH FOR A GOOD BUYING POINT', detail: 'This improves the picture, but the price, the correct account cash and the safety rules still have to line up before buying.' };
  }
  return { title: 'KEEP THE CURRENT PLAN', detail: 'The event is worth remembering, but it is not strong enough to change where your money goes by itself.' };
}

function PolicyRadar({ events }: { events: IntelligenceEvent[] }) {
  const policy = events.filter((event) => event.sourceClass === 'primary_source' || event.sourceClass === 'policy_proxy').slice(0, 10);
  return (
    <Card label="Policy" title="What government decisions could change">
      {policy.length ? (
        <div className="stack stack--tight">
          {policy.map((event) => (
            <div key={event.fingerprint} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>{event.sector === 'cross_market' ? 'Across markets' : SECTOR_NAME[event.sector]}</strong>
                <Badge tone={badgeTone(event.direction)}>{event.direction}</Badge>
              </div>
              <p className="meta">{event.headline}</p>
              <p>{strategyView(event)}</p>
            </div>
          ))}
        </div>
      ) : <p className="meta">No policy item currently stored is strong enough to affect your strategies.</p>}
    </Card>
  );
}

function HistoricalPanel({ result }: { result: HistoricalRelevance }) {
  const line = (label: string, row: HistoricalRelevance['oneDay']) => (
    <div className="key-value">
      <span>{label}</span>
      <strong>{row.count ? `${formatPct(row.median ?? 0, 1)} typical · ${formatPct(row.min ?? 0, 1)} to ${formatPct(row.max ?? 0, 1)} · ${row.count} examples` : 'Not enough history yet'}</strong>
    </div>
  );
  return (
    <div className="banner banner--intel" style={{ marginTop: 10 }}>
      <div style={{ width: '100%' }}>
        <strong>What happened after similar events</strong>
        <p className="meta">{result.summary}</p>
        {line('After 1 trading day', result.oneDay)}
        {line('After 5 trading days', result.fiveDay)}
        {line('After 20 trading days', result.twentyDay)}
        <p className="meta">These are observed results from similar stored events, not odds that the current event will repeat them.</p>
      </div>
    </div>
  );
}

function CapitalSignals({ events }: { events: IntelligenceEvent[] }) {
  return (
    <Card label="Public money moves" title="What disclosed buying, selling and positioning may be telling us">
      {events.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>What happened</th><th>Asset</th><th>Direction</th><th>Timing</th><th>How to use it</th></tr></thead>
            <tbody>
              {events.slice(0, 14).map((event) => (
                <tr key={event.fingerprint}>
                  <th>{event.headline}</th>
                  <td>{event.symbols.join(', ') || '—'}</td>
                  <td><Badge tone={badgeTone(event.direction)}>{event.direction}</Badge></td>
                  <td>{latencyLabel(event)}{typeof event.metadata?.reportingGap === 'string' ? ` · ${event.metadata.reportingGap}` : ''}</td>
                  <td>{event.latency === 'retrospective' || event.latency === 'delayed_disclosure' ? 'Context only — compare it with today’s price and other evidence.' : 'Useful evidence, but not enough to justify a trade on its own.'}</td>
                </tr>
              ))}
            </tbody></table>
        </div>
      ) : <p className="meta">No relevant public money-movement disclosure is stored yet.</p>}
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
  const advanced = useResource(() => refreshToken ? intelligenceApi.refreshAdvanced() : intelligenceApi.advanced(), [refreshToken]);
  const diagnostics = useResource(() => intelligenceApi.diagnostics(), [refreshToken]);
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);

  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (signals.error) return <ErrorState error={signals.error} onRetry={signals.reload} />;
  if (!intelligence.data || !portfolio.data || !signals.data) return <LoadingCards count={6} />;
  const data = intelligence.data;
  const p = portfolio.data;
  const growthCash = p.accounts.filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible).reduce((sum, row) => sum + row.cash, 0);
  const important = data.events.filter((event) => event.severity === 'high' || event.severity === 'medium').slice(0, 8);
  const v3 = advanced.data;
  const openbb = data.providers.find((provider) => provider.provider === 'openbb');
  const finnhub = data.providers.find((provider) => provider.provider === 'finnhub');
  const connectionProblem = diagnostics.data?.overall === 'blocked' || openbb?.status === 'unavailable';

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
        eyebrow="Market information"
        title="What changed — and does it change your plan?"
        lede="This page brings together prices, market history, company information, policy and public disclosures, then shows only what could actually matter to your holdings or next decision."
        action={<button type="button" className="btn btn--sm btn--ghost" disabled={intelligence.refreshing || advanced.refreshing} onClick={() => setRefreshToken((value) => value + 1)}>{intelligence.refreshing || advanced.refreshing ? 'Refreshing…' : 'Refresh market information'}</button>}
      />

      <Card
        label="Data connections"
        title={connectionProblem ? 'Some live market data is not getting through' : 'What the app can see right now'}
        tone={connectionProblem ? 'risk' : 'default'}
        action={<Badge tone={connectionProblem ? 'negative' : 'positive'}>{connectionProblem ? 'Needs attention' : 'Checked'}</Badge>}
      >
        <div className="grid grid--3">
          <div className="panel">
            <span className="soft">OpenBB / Google</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{openbb?.status ?? 'unknown'}</strong>
            <p className="meta">Quotes, price history, dividends, indexes, macro data and most of the deeper research lanes.</p>
          </div>
          <div className="panel">
            <span className="soft">Finnhub</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{finnhub?.status ?? 'unknown'}</strong>
            <p className="meta">Ticker reference information, company events and earnings evidence.</p>
          </div>
          <div className="panel">
            <span className="soft">Deeper research coverage</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{v3 ? `${v3.fusion.coveragePct}%` : 'Checking…'}</strong>
            <p className="meta">{v3 ? `${v3.fusion.liveLaneCount} of 8 lanes live · ${v3.fusion.partialLaneCount} partial · ${v3.fusion.unavailableLaneCount} unavailable.` : 'Loading the eight research lanes.'}</p>
          </div>
        </div>

        {diagnostics.data ? (
          <div className={`banner ${diagnostics.data.overall === 'blocked' ? 'banner--mock' : 'banner--intel'}`} style={{ marginTop: 14 }}>
            <div>
              <strong>{diagnostics.data.overall === 'working' ? 'The signed Google/OpenBB path is working' : 'Connection check'}</strong>
              <p className="meta">{diagnostics.data.nextStep}</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {diagnostics.data.checks.map((check) => <Badge key={check.label} tone={badgeTone(check.state)}>{check.label}: {check.state}</Badge>)}
              </div>
            </div>
          </div>
        ) : diagnostics.error ? (
          <p className="meta" style={{ marginTop: 12 }}>The connection check could not run, so provider health is not being guessed.</p>
        ) : null}

        {v3 ? (
          <div className="grid grid--4" style={{ marginTop: 14 }}>
            {Object.values(v3.lanes).map((lane) => (
              <div className="panel" key={lane.lane}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <strong>{LANE_NAME[lane.lane] ?? lane.lane}</strong>
                  <Badge tone={badgeTone(lane.status)}>{lane.status}</Badge>
                </div>
                <p className="meta">{lane.itemCount} item{lane.itemCount === 1 ? '' : 's'} · {lane.sources.join(' + ')}</p>
                {lane.status !== 'live' && lane.caveats[0] ? <p className="meta">{lane.caveats[0]}</p> : null}
              </div>
            ))}
          </div>
        ) : advanced.error ? <p className="meta" style={{ marginTop: 12 }}>The deeper research lanes could not be loaded. Their status is unknown rather than assumed.</p> : null}
      </Card>

      <div className="section"><MarketPulseTicker items={data.marketPulse} /></div>

      <div className="section">
        <AssetDecisionTranslator signals={signals.data.signals} pulses={data.pulses} marketPulse={data.marketPulse} />
      </div>

      <div className="section"><GovernmentTradingTicker signals={data.governmentTrading} /></div>

      <div className="grid grid--4 section">
        {data.pulses.map((pulse) => <PulseCard key={pulse.sector} pulse={pulse} />)}
      </div>

      <div className="grid grid--wide-left section">
        <Card label="Today's important events" title="Only information that could matter to your plan">
          {important.length ? (
            <div className="stack">
              {important.map((event) => {
                const action = actionForEvent(event);
                return (
                  <div key={event.fingerprint} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 18 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone={event.severity === 'high' ? 'negative' : 'warning'}>{event.severity.toUpperCase()} IMPACT</Badge>
                      <Badge tone="neutral">{latencyLabel(event)}</Badge>
                      <Badge tone="intel">{event.sourceClass === 'primary_source' ? 'PRIMARY SOURCE' : event.sourceClass === 'analyst_commentary' ? 'ANALYST RESEARCH' : event.sourceClass === 'market_benchmark' ? 'MARKET DATA' : event.sourceClass === 'openbb' ? 'OPENBB CHECK' : 'MARKET SOURCE'}</Badge>
                    </div>
                    <h3 style={{ marginTop: 10 }}>{event.headline}</h3>
                    <p className="meta">{event.source} · {event.sector === 'cross_market' ? 'Across markets' : SECTOR_NAME[event.sector]}</p>
                    {event.symbols.length ? <p><strong>Affected:</strong> {event.symbols.join(' · ')}</p> : null}

                    <p className="card__label" style={{ marginTop: 12 }}><span>What it means for you</span></p>
                    <p>{strategyView(event)}</p>

                    <div className="banner" style={{ marginTop: 10 }}>
                      <div>
                        <strong>{action.title}</strong>
                        <p className="meta">{action.detail}{event.sector === 'semiconductors' && action.title.includes('CASH') ? ` Growth cash currently available: ${formatMoney(growthCash)}.` : ''}</p>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setWhyOpen(whyOpen === event.fingerprint ? null : event.fingerprint)}>Why?</button>
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => openHistory(event)}>What happened after similar events?</button>
                      <Link className="btn btn--sm btn--gold" to={`/modeling-lab?event=${encodeURIComponent(event.fingerprint)}&sector=${encodeURIComponent(event.sector)}&eventType=${encodeURIComponent(event.eventType)}`}>See what this could change</Link>
                      {event.sourceUrl ? <a className="btn btn--sm btn--ghost" href={event.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}
                    </div>
                    {whyOpen === event.fingerprint ? (
                      <div className="panel" style={{ marginTop: 10 }}>
                        <strong>Why it matters</strong>
                        <p>{action.title.startsWith('WAIT') ? 'Keeping cash available is still a decision: it preserves buying power for a price where the potential reward better compensates for the risk.' : action.title.startsWith('WATCH') ? 'This improves one part of the picture, but buying before price, available cash and the safety rules line up would be speculation.' : 'The best action is to keep the existing plan until this information becomes stronger or is confirmed by price and portfolio conditions.'}</p>
                      </div>
                    ) : null}
                    {historicalFor === event.fingerprint ? historicalBusy ? <p className="meta">Checking similar events…</p> : historical ? <HistoricalPanel result={historical} /> : null : null}
                  </div>
                );
              })}
            </div>
          ) : <p className="meta">Nothing important enough to change your plan is currently stored.</p>}
        </Card>

        <PolicyRadar events={data.events} />
      </div>

      <div className="section"><CapitalSignals events={data.capitalSignals} /></div>

      <details className="section">
        <summary className="btn btn--ghost">Technical source details</summary>
        <div className="grid grid--3" style={{ marginTop: 14 }}>
          {data.providers.map((provider) => (
            <div key={provider.provider} className="panel">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><strong>{provider.provider.replace(/_/g, ' ')}</strong><Badge tone={badgeTone(provider.status)}>{provider.status}</Badge></div>
              <p className="meta">{provider.note}</p>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
