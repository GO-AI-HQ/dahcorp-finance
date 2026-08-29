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
  const growthCash = p.accounts
    .filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const incomeCash = p.accounts
    .filter((row) => row.account.broker === 'schwab' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const semiPulse = intelligence.data?.pulses.find((row) => row.sector === 'semiconductors');
  const energyPulse = intelligence.data?.pulses.find((row) => row.sector === 'energy');

  const qualifiedDips = d.signals
    .filter((row) => row.dip.actionable && row.trend.status === 'TREND_CONFIRMED')
    .sort((a, b) => (b.dip.declineFromReference ?? 0) - (a.dip.declineFromReference ?? 0));
  const topIncome = d.opportunities.find((row) => !row.held && row.scoreDeltaVsHeld != null && row.scoreDeltaVsHeld > 0) ?? d.opportunities[0] ?? null;

  return (
    <>
      <PageHead
        eyebrow="Growth · Opportunities"
        title="Opportunities that could actually move the goal"
        lede="A ticker does not earn a recommendation just because it scores well or has fallen in price. DAHCorp asks what improves the plan, why now, which cash mandate would fund it, and what evidence could invalidate the move."
      />

      <div className="grid grid--4 section">
        <Card label="Growth cash available" title={formatMoney(growthCash)}><p className="meta">Robinhood Agentic · may remain queued.</p></Card>
        <Card label="Income cash available" title={formatMoney(incomeCash)}><p className="meta">Authorized Schwab Income account only.</p></Card>
        <Card label="Semiconductor intelligence" title={semiPulse?.label ?? 'Building evidence'}><p className="meta">Policy {semiPulse?.policy ?? 'unknown'} · news {semiPulse?.newsPressure ?? 'unknown'}.</p></Card>
        <Card label="Energy intelligence" title={energyPulse?.label ?? 'Building evidence'}><p className="meta">Policy {energyPulse?.policy ?? 'unknown'} · capital signals {energyPulse?.capitalSignals ?? 'unknown'}.</p></Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Price opportunities" title={qualifiedDips.length ? `${qualifiedDips.length} qualified buy-zone setup${qualifiedDips.length === 1 ? '' : 's'}` : 'No qualified buy-zone setup'}>
          {qualifiedDips.length ? (
            <div className="stack stack--tight">
              {qualifiedDips.slice(0, 5).map((row) => (
                <div key={row.symbol}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <strong>{row.symbol} — REVIEW ENTRY</strong>
                    <Badge tone="positive">Buy zone reached</Badge>
                  </div>
                  <p className="meta">{formatPct(row.dip.declineFromReference ?? 0, 1)} below reference while market health remains confirmed. This is a setup to evaluate, not an automatic buy.</p>
                </div>
              ))}
            </div>
          ) : <p className="meta">Cash remains more valuable than forcing an entry. DAHCorp will continue watching configured buy zones.</p>}
        </Card>

        <Card label="Income opportunity" title={topIncome ? `${topIncome.symbol} — research whether it improves cash efficiency` : 'No income candidate can be scored'}>
          {topIncome ? (
            <>
              <p className="meta">Score {formatNumber(topIncome.efficiency.score, 1)}{topIncome.scoreDeltaVsHeld == null ? '' : ` · ${topIncome.scoreDeltaVsHeld > 0 ? '+' : ''}${formatNumber(topIncome.scoreDeltaVsHeld, 1)} versus the best held income position`}.</p>
              <p>{topIncome.verdictReason}</p>
              <div className="banner" style={{ marginTop: 10 }}>
                <strong>Benefit test</strong>
                <p className="meta">Only move capital if the candidate improves the income objective after NAV behavior, total return, return of capital, overlap, liquidity and risk are considered. A higher distribution rate alone is not enough.</p>
              </div>
            </>
          ) : <p className="meta">Quotes and distribution history are required before DAHCorp can compare income efficiency.</p>}
        </Card>
      </div>

      <Card label="Decision path" title="Turn an opportunity into an action">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--ghost" to="/intelligence">1 · Check Intelligence</Link>
          <Link className="btn btn--sm btn--ghost" to="/strategy-lab">2 · Test in Strategy Lab</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">3 · Open Cash Queue</Link>
        </div>
        <p className="meta" style={{ marginTop: 10 }}>An opportunity becomes an order only after the portfolio mandate, cash amount and deterministic risk checks are satisfied.</p>
      </Card>

      <details className="section">
        <summary className="btn btn--ghost">View advanced opportunity scoring and dip engine</summary>
        <div style={{ marginTop: 16 }}><Opportunities /></div>
      </details>
    </>
  );
}
