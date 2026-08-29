import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { formatMoney, formatNumber, formatPct } from '../core/format.js';
import { Opportunities } from './Opportunities.js';

export function GrowthOpportunities() {
  const signals = useResource(() => api.signals(), []);
  const portfolio = useResource(() => api.portfolio(), []);
  const intelligence = useResource(() => intelligenceApi.current(), []);

  if (signals.error) return <ErrorState error={signals.error} onRetry={signals.reload} />;
  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!signals.data || !portfolio.data) return <LoadingCards count={5} />;

  const d = signals.data;
  const p = portfolio.data;
  const growthCash = p.accounts.filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible).reduce((sum, row) => sum + row.cash, 0);
  const incomeCash = p.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Income')).reduce((sum, row) => sum + row.cash, 0);
  const maritimeCash = p.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Maritime')).reduce((sum, row) => sum + row.cash, 0);
  const semiPulse = intelligence.data?.pulses.find((row) => row.sector === 'semiconductors');
  const energyPulse = intelligence.data?.pulses.find((row) => row.sector === 'energy');
  const shippingPulse = intelligence.data?.pulses.find((row) => row.sector === 'shipping');
  const technologyPulse = intelligence.data?.pulses.find((row) => row.sector === 'technology');

  const qualifiedDips = d.signals
    .filter((row) => row.dip.actionable && row.trend.status === 'TREND_CONFIRMED')
    .sort((a, b) => (b.dip.declineFromReference ?? 0) - (a.dip.declineFromReference ?? 0));
  const topIncome = d.opportunities.find((row) => !row.held && row.scoreDeltaVsHeld != null && row.scoreDeltaVsHeld >= 10)
    ?? d.opportunities.find((row) => !row.held && row.scoreDeltaVsHeld != null && row.scoreDeltaVsHeld > 0)
    ?? null;

  return (
    <>
      <PageHead
        eyebrow="Growth · Opportunities"
        title="Opportunities that could actually move the goal"
        lede="A ticker does not earn a recommendation just because it scores well or has fallen in price. DAHCorp asks what improves the plan, why now, which cash mandate would fund it, and what evidence could invalidate the move."
      />

      <div className="grid grid--4 section">
        <Card label="Growth cash available" title={formatMoney(growthCash)}><p className="meta">Robinhood Agentic · may remain queued.</p></Card>
        <Card label="Income cash available" title={formatMoney(incomeCash)}><p className="meta">Schwab Income 3085 only.</p></Card>
        <Card label="Maritime cash available" title={formatMoney(maritimeCash)}><p className="meta">Shipping mandate only; never silently mixed with Income cash.</p></Card>
        <Card label="Sector pulse" title={`${semiPulse?.label ?? '—'} / ${energyPulse?.label ?? '—'}`}><p className="meta">Semi / Energy. Shipping {shippingPulse?.label ?? '—'} · Technology {technologyPulse?.label ?? '—'}.</p></Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Price opportunities" title={qualifiedDips.length ? `${qualifiedDips.length} qualified buy-zone setup${qualifiedDips.length === 1 ? '' : 's'}` : 'No qualified buy-zone setup'}>
          {qualifiedDips.length ? (
            <div className="stack stack--tight">
              {qualifiedDips.slice(0, 5).map((row) => (
                <div key={row.symbol}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <strong>{row.symbol} — MODEL ENTRY</strong>
                    <Badge tone="positive">Buy zone reached</Badge>
                  </div>
                  <p className="meta">{formatPct(row.dip.declineFromReference ?? 0, 1)} below reference while market health remains confirmed.</p>
                  <Link className="btn btn--sm btn--ghost" to={`/modeling-lab?symbol=${encodeURIComponent(row.symbol)}&side=buy&question=${encodeURIComponent(`Should I BUY ${row.symbol} now? Compare the specific dollar purchase with holding the relevant cash queue and recommend an amount only if it improves the strategy.`)}`}>Model {row.symbol}</Link>
                </div>
              ))}
            </div>
          ) : <p className="meta">Cash remains more valuable than forcing an entry. DAHCorp will continue watching configured buy zones.</p>}
        </Card>

        <Card label="Income challenger" title={topIncome ? `${topIncome.symbol} — test whether it meaningfully improves income efficiency` : 'No income challenger established'}>
          {topIncome ? (
            <>
              <p className="meta">Score {formatNumber(topIncome.efficiency.score, 1)}{topIncome.scoreDeltaVsHeld == null ? '' : ` · ${topIncome.scoreDeltaVsHeld > 0 ? '+' : ''}${formatNumber(topIncome.scoreDeltaVsHeld, 1)} points versus the best held income position`}.</p>
              <p>{topIncome.verdictReason}</p>
              <div className="banner" style={{ marginTop: 10 }}>
                <strong>{(topIncome.scoreDeltaVsHeld ?? 0) >= 10 ? '10-point challenger threshold met' : 'Below the preferred +10-point hurdle'}</strong>
                <p className="meta">A rotation still must improve the $500/month objective after NAV behavior, total return, return of capital, overlap, liquidity and risk. A higher distribution rate alone is not enough.</p>
              </div>
              <p style={{ marginTop: 10 }}><Link className="btn btn--sm btn--ghost" to={`/modeling-lab?question=${encodeURIComponent(`Compare my current Income Engine with rotating some eligible Income capital into ${topIncome.symbol}. Only recommend a rotation if it materially improves the path to $500/month after total return, NAV behavior, return of capital and risk.`)}`}>Model income rotation</Link></p>
            </>
          ) : <p className="meta">Quotes and distribution history are required before DAHCorp can compare income efficiency.</p>}
        </Card>
      </div>

      <Card label="Decision path" title="Turn an opportunity into an action">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--ghost" to="/intelligence">1 · Check Intelligence</Link>
          <Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent('Review the strongest current portfolio opportunity across Growth, Income and Maritime mandates. Recommend a concrete transaction only if it materially improves the relevant goal versus holding cash.')}`}>2 · Build Proposed Model</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">3 · Preview / execute</Link>
        </div>
        <p className="meta" style={{ marginTop: 10 }}>The Modeling Lab chooses a dollar amount and transaction plan. Portfolio remains the action queue where live-capable legs are previewed and confirmed.</p>
      </Card>

      <details className="section">
        <summary className="btn btn--ghost">View advanced opportunity scoring and dip engine</summary>
        <div style={{ marginTop: 16 }}><Opportunities /></div>
      </details>
    </>
  );
}
