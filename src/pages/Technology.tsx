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
import { modelFractionalAdd } from '../strategy/dca.js';

const DCA_EXAMPLE_DOLLARS = 50;

function tone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['Constructive', 'constructive', 'positive'].includes(value)) return 'positive';
  if (['Cautious', 'restrictive', 'negative'].includes(value)) return 'negative';
  if (['Watching', 'mixed'].includes(value)) return 'warning';
  return 'neutral';
}

function shares(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(5);
}

function strategyLabel(symbol: string): string {
  if (symbol === 'NVDA') return 'Quality-growth DCA · semiconductor overlap check';
  if (symbol === 'WMT') return 'Long-horizon DCA · consumer / quality-growth lane';
  return 'Long-horizon quality-growth DCA';
}

function averageCostSentence(model: ReturnType<typeof modelFractionalAdd>): string {
  if (!model) return 'Fractional-share math is unavailable because a valid current price is missing.';
  if (model.averageCostEffect === 'lower' && model.currentAverageCost != null && model.projectedAverageCost != null) {
    return `At the current price, this example would lower average cost from ${formatMoney(model.currentAverageCost)} to about ${formatMoney(model.projectedAverageCost)} per share.`;
  }
  if (model.averageCostEffect === 'raise' && model.currentAverageCost != null && model.projectedAverageCost != null) {
    return `At the current price, this example would raise average cost from ${formatMoney(model.currentAverageCost)} to about ${formatMoney(model.projectedAverageCost)} per share. DCA can still build the position, but this would not be “averaging down.”`;
  }
  if (model.averageCostEffect === 'flat' && model.currentAverageCost != null) {
    return `The current price is near the existing average cost of ${formatMoney(model.currentAverageCost)} per share, so the example would leave average cost essentially unchanged.`;
  }
  if (model.averageCostEffect === 'establish') {
    return 'No current position is confirmed, so a fractional purchase would establish a new starting cost basis near the current price.';
  }
  return 'The current cost basis is not verified, so DAHCorp will not claim that an add raises or lowers average cost.';
}

export function Technology() {
  const intelligence = useResource(() => intelligenceApi.current(), []);
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);

  if (intelligence.error) return <ErrorState error={intelligence.error} onRetry={intelligence.reload} />;
  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (signals.error) return <ErrorState error={signals.error} onRetry={signals.reload} />;
  if (!intelligence.data || !portfolio.data || !signals.data) return <LoadingCards count={5} />;

  const p = portfolio.data;
  const pulse = intelligence.data.pulses.find((item) => item.sector === 'technology');
  const events = intelligence.data.events.filter((event) => event.sector === 'technology' || event.sector === 'cross_market');
  const growthAccounts = p.accounts.filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible);
  const growthCash = growthAccounts.reduce((sum, row) => sum + row.cash, 0);
  const preferredGrowthAccount = [...growthAccounts].sort((a, b) => b.cash - a.cash)[0] ?? null;
  const positions = p.positions.filter((position) => TECHNOLOGY_INTELLIGENCE_SYMBOLS.includes(position.symbol as (typeof TECHNOLOGY_INTELLIGENCE_SYMBOLS)[number]));
  const techSignals = signals.data.signals.filter((row) => TECHNOLOGY_INTELLIGENCE_SYMBOLS.includes(row.symbol as (typeof TECHNOLOGY_INTELLIGENCE_SYMBOLS)[number]));
  const qualified = techSignals.find((row) => row.dip.actionable && row.trend.status === 'TREND_CONFIRMED') ?? null;
  const highImpact = events.find((event) => event.severity === 'high') ?? events[0] ?? null;

  const decision = pulse?.label === 'Cautious'
    ? 'WAIT — policy / market evidence is restrictive'
    : qualified
      ? `MODEL ${qualified.symbol} ALLOCATION — setup qualifies; amount not decided`
      : 'WATCH — no Technology allocation needs to be modeled now';

  const modelTo = highImpact
    ? `/modeling-lab?event=${encodeURIComponent(highImpact.fingerprint)}&question=${encodeURIComponent('Given the latest Technology intelligence, my current Robinhood growth holdings, verified cost bases, available Growth cash and long-horizon DCA strategy, should I add to an existing quality-growth position, initiate a new fractional position, or hold cash? If an add is justified, specify the account, exact dollar amount, estimated fractional shares, projected average cost and remaining cash.')}`
    : `/modeling-lab?question=${encodeURIComponent('Given my current quality-growth Technology exposure, verified cost bases and available Robinhood Growth cash, should I add to an existing position, initiate a new fractional position, or hold cash? If an add is justified, specify the account, exact dollar amount, estimated fractional shares, projected average cost and remaining cash.')}`;

  return (
    <>
      <PageHead
        eyebrow="Growth · Technology"
        title="Quality growth / Technology"
        lede="Technology is evaluated as a long-horizon accumulation lane. A favorable price/trend setup makes a security eligible for allocation modeling; it does not mean “buy now.” Fractional DCA can build larger positions over time without requiring a full-share purchase."
        action={pulse ? <Badge tone={tone(pulse.label)}>{pulse.label}</Badge> : <Badge tone="neutral">Building evidence</Badge>}
      />

      <div className="grid grid--4 section">
        <Card label="Current decision" title={decision}><p className="meta">Price qualification opens the modeling step. Cash, current holdings, average cost, portfolio overlap, intelligence and risk still determine whether any purchase should occur.</p></Card>
        <Card label="Growth Cash Queue" title={formatMoney(growthCash)}><p className="meta">{growthAccounts.length ? `${growthAccounts.map((row) => `${row.account.name}: ${formatMoney(row.cash)}`).join(' · ')}. ` : ''}Cash can remain idle or be combined with a future contribution before a fractional add.</p></Card>
        <Card label="Current Technology holdings" title={`${positions.length} position${positions.length === 1 ? '' : 's'}`}><p className="meta">{positions.length ? positions.map((position) => `${position.symbol} ${shares(position.shares)} sh`).join(' · ') : 'No confirmed Technology/watch-universe position is currently held.'}</p></Card>
        <Card label="Latest evidence" title={highImpact?.headline ?? 'No material Technology event stored'}><p className="meta">{highImpact ? `${highImpact.source} · ${highImpact.eventType}` : 'Missing evidence is not treated as neutral.'}</p></Card>
      </div>

      <Card label="Technology decision engine" title="Quality + valuation + DCA entry + portfolio fit">
        <div className="grid grid--4">
          <div className="panel"><strong>Business quality</strong><p className="meta">Earnings, cloud/AI demand, advertising/e-commerce demand and capital intensity.</p></div>
          <div className="panel"><strong>Policy risk</strong><p className="meta">Antitrust, AI/privacy rules and other regulation that can change the earnings or valuation path.</p></div>
          <div className="panel"><strong>Price setup</strong><p className="meta">Trend health and planned entry zones determine whether an allocation deserves modeling; price weakness alone is not sufficient.</p></div>
          <div className="panel"><strong>Portfolio + cash</strong><p className="meta">Current shares, average cost, account cash and AI/mega-cap overlap determine the size and destination of any fractional DCA add.</p></div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn--gold" to={modelTo}>Model the Technology allocation</Link>
          <Link className="btn btn--ghost" to="/intelligence">Open Technology intelligence</Link>
          <Link className="btn btn--ghost" to="/portfolio">Open Growth Cash Queue</Link>
        </div>
      </Card>

      <div className="grid grid--2 section">
        <Card label="Price / trend + portfolio evidence" title="Current accumulation setups">
          {techSignals.length ? (
            <div className="stack stack--tight">
              {techSignals.slice(0, 8).map((row) => {
                const eligible = row.dip.actionable && row.trend.status === 'TREND_CONFIRMED';
                const position = p.positions.find((item) => item.symbol === row.symbol) ?? null;
                const positionAccount = position ? p.accounts.find((item) => item.account.id === position.accountId) ?? null : null;
                const targetAccount = positionAccount?.account.allocationEligible ? positionAccount : preferredGrowthAccount;
                const example = modelFractionalAdd({
                  price: row.price,
                  dollars: DCA_EXAMPLE_DOLLARS,
                  currentShares: position?.shares ?? 0,
                  currentCostBasisTotal: position?.costBasisTotal ?? 0,
                  costBasisKnown: position?.costBasisKnown ?? true,
                });
                const fundingGap = Math.max(0, DCA_EXAMPLE_DOLLARS - (targetAccount?.cash ?? 0));
                const accountName = targetAccount?.account.name ?? 'the Growth account';
                const basisText = position
                  ? `${shares(position.shares)} shares${position.costBasisKnown && position.costBasisPerShare != null ? ` · ${formatMoney(position.costBasisPerShare)} avg cost` : ' · average cost unverified'}`
                  : 'No confirmed position yet';
                const modelQuestion = `Evaluate a ${row.symbol} fractional DCA / entry allocation. The deterministic setup is ${eligible ? 'qualified for modeling' : 'not currently qualified'}. Target account: ${accountName}, current account cash ${formatMoney(targetAccount?.cash ?? 0)}. Current holding: ${basisText}. Strategy: ${strategyLabel(row.symbol)}. If a purchase improves the plan, tell me exactly how much cash to add to the account if needed, the purchase dollar amount, estimated fractional shares at the current price, projected average cost after the add, remaining cash, and why that size is preferable to holding cash. Do not turn the buy-zone flag into an automatic trade.`;
                const rowModelTo = `/modeling-lab?symbol=${encodeURIComponent(row.symbol)}&side=buy&question=${encodeURIComponent(modelQuestion)}`;
                return (
                  <div key={row.symbol} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong>{row.symbol}</strong>
                      <Badge tone={eligible ? 'positive' : 'neutral'}>{eligible ? 'Eligible to model' : 'Watch'}</Badge>
                    </div>
                    <p className="meta">Setup: trend {row.trend.status.replace(/_/g, ' ').toLowerCase()} · buy zone {row.dip.actionable ? 'reached' : 'not reached'}. Eligibility means “calculate the allocation,” not “buy automatically.”</p>
                    <div className="grid grid--2" style={{ marginTop: 8 }}>
                      <div className="panel"><strong>{accountName}</strong><p className="meta">Available cash: {formatMoney(targetAccount?.cash ?? 0)} · {strategyLabel(row.symbol)}</p></div>
                      <div className="panel"><strong>{basisText}</strong><p className="meta">Current price: {formatMoney(row.price)} · Market value: {formatMoney(position?.marketValue ?? 0)}</p></div>
                    </div>
                    {example ? <p className="meta" style={{ marginTop: 8 }}><strong>Illustrative {formatMoney(DCA_EXAMPLE_DOLLARS)} DCA step:</strong> about {shares(example.estimatedShares)} fractional shares. {averageCostSentence(example)} {fundingGap > 0 ? `That example would require adding ${formatMoney(fundingGap)} to ${accountName}.` : `${accountName} currently has enough cash to cover that example.`} This is sizing math, not a recommendation.</p> : null}
                    {eligible ? <p style={{ marginTop: 10 }}><Link className="btn btn--sm btn--ghost" to={rowModelTo}>Model {row.symbol} cash + fractional add</Link></p> : null}
                  </div>
                );
              })}
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
