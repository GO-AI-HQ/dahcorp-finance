import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { formatMoney, formatPct } from '../core/format.js';
import { Semiconductor } from './Semiconductor.js';

function plainTrend(status: string): string {
  if (status === 'TREND_CONFIRMED') return 'Healthy enough to evaluate';
  if (status === 'TREND_WEAKENING') return 'Weakening — be selective';
  if (status === 'TREND_LOST') return 'Trend broken — do not add';
  return 'Not enough evidence yet';
}

export function SemiconductorGrowth() {
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);
  const intelligence = useResource(() => intelligenceApi.current(), []);

  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (signals.error) return <ErrorState error={signals.error} onRetry={signals.reload} />;
  if (!portfolio.data || !signals.data) return <LoadingCards count={5} />;

  const p = portfolio.data;
  const d = signals.data;
  const growthCash = p.accounts
    .filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const pulse = intelligence.data?.pulses.find((row) => row.sector === 'semiconductors') ?? null;
  const coreSymbols = ['SEMI', 'SMH', 'AMD'];
  const core = coreSymbols.map((symbol) => d.signals.find((row) => row.symbol === symbol)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const tactical = ['SOXL', 'TSMX'].map((symbol) => d.signals.find((row) => row.symbol === symbol)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const restrictiveIntel = pulse?.label === 'Cautious' || pulse?.policy === 'restrictive';

  const best = core
    .filter((row) => row.dip.actionable && row.trend.status === 'TREND_CONFIRMED')
    .sort((a, b) => (b.dip.declineFromReference ?? 0) - (a.dip.declineFromReference ?? 0))[0] ?? null;
  const headline = restrictiveIntel
    ? 'WAIT — policy evidence argues for caution'
    : best
      ? `${best.symbol} — setup qualifies for allocation modeling`
      : 'WAIT — no core semiconductor allocation currently qualifies';
  const modelQuestion = best
    ? `A ${best.symbol} semiconductor buy zone is active. Compare a fractional/DCA add to ${best.symbol}, holding Growth cash, and any permitted tactical alternative such as SOXL/TSMX. Use current holdings, cost basis, account cash, portfolio overlap and intelligence. Recommend a specific dollar amount and estimated fractional shares only if the move improves the strategy; the buy-zone flag itself is not a buy instruction.`
    : 'Review the semiconductor Growth mandate. Should I hold cash, accumulate a core name through fractional/DCA purchases, or prepare a tactical semiconductor trade? Use current holdings, cost basis and account cash. Do not manufacture a transaction if no setup qualifies.';
  const modelTo = `/modeling-lab?question=${encodeURIComponent(modelQuestion)}`;

  return (
    <>
      <PageHead
        eyebrow="Growth · Semiconductors"
        title="Semiconductor growth"
        lede="DAHCorp combines price opportunity, market health, policy/news intelligence, current holdings and available Growth cash before recommending a decision. A buy zone means the security is eligible to model—not that it should be purchased automatically."
        action={<Badge tone={best && !restrictiveIntel ? 'positive' : restrictiveIntel ? 'warning' : 'neutral'}>{best && !restrictiveIntel ? 'Opportunity developing' : 'Watching'}</Badge>}
      />

      <Card label="Current decision" title={headline}>
        <div className="grid grid--4">
          <div className="panel"><span className="soft">Growth Cash Queue</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(growthCash)}</strong><p className="meta">Cash may remain idle or combine with future contributions for fractional accumulation.</p></div>
          <div className="panel"><span className="soft">Market Intelligence</span><strong style={{ display: 'block', marginTop: 4 }}>{pulse?.label ?? 'Building evidence'}</strong><p className="meta">Policy: {pulse?.policy ?? 'unknown'} · News: {pulse?.newsPressure ?? 'unknown'}</p></div>
          <div className="panel"><span className="soft">Best price setup</span><strong style={{ display: 'block', marginTop: 4 }}>{best?.symbol ?? 'None qualified'}</strong><p className="meta">{best ? `${formatPct(best.dip.declineFromReference ?? 0, 1)} below its reference.` : 'A decline alone is not enough.'}</p></div>
          <div className="panel"><span className="soft">Allocation amount</span><strong style={{ display: 'block', marginTop: 4 }}>Modeling Lab decides</strong><p className="meta">The amount comes from live cash, current shares/cost basis, overlap, evidence and risk—not an arbitrary tranche percentage.</p></div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--gold" to={modelTo}>Build Proposed Allocation</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">Open Growth Cash Queue</Link>
          <Link className="btn btn--sm btn--ghost" to="/intelligence">Why the market view?</Link>
        </div>
      </Card>

      <div className="grid grid--3 section">
        {core.map((row) => {
          const decision = restrictiveIntel
            ? 'WAIT'
            : row.trend.status !== 'TREND_CONFIRMED'
              ? 'WATCH'
              : row.dip.actionable
                ? 'ELIGIBLE TO MODEL'
                : 'WAIT';
          const position = p.positions.find((item) => item.symbol === row.symbol) ?? null;
          const holdingSummary = position
            ? `${position.shares.toFixed(position.shares >= 1 ? 3 : 5)} sh${position.costBasisKnown && position.costBasisPerShare != null ? ` · ${formatMoney(position.costBasisPerShare)} avg cost` : ''}`
            : 'No confirmed position';
          const rowModelTo = `/modeling-lab?symbol=${encodeURIComponent(row.symbol)}&side=buy&question=${encodeURIComponent(`Should I make a fractional/DCA add to ${row.symbol} now from the Robinhood Growth Cash Queue? Current holding: ${holdingSummary}. Growth cash: ${formatMoney(growthCash)}. Compare the proposed purchase with holding cash, and if an add improves the plan give the exact dollar amount, estimated fractional shares, projected average cost and remaining cash. Do not treat the buy-zone flag as an automatic trade.`)}`;
          return (
            <Card key={row.symbol} label={`${row.symbol} · Core growth`} title={decision} action={<Badge tone={decision === 'ELIGIBLE TO MODEL' ? 'positive' : 'neutral'}>{row.dip.actionable ? 'Buy zone reached' : 'No buy zone'}</Badge>}>
              <p><strong>{plainTrend(row.trend.status)}</strong></p>
              <p className="meta">Price {formatMoney(row.price)} · {row.dip.declineFromReference == null ? 'reference unavailable' : `${formatPct(row.dip.declineFromReference, 1)} below reference`}.</p>
              <p className="meta"><strong>Portfolio:</strong> {holdingSummary} · Growth cash {formatMoney(growthCash)}.</p>
              <p className="meta">{row.dip.actionable && row.trend.status === 'TREND_CONFIRMED' ? 'The price has reached a planned zone without breaking trend. That opens allocation modeling; it does not decide whether or how much to buy.' : 'One or more conditions needed before allocation modeling are still missing.'}</p>
              {decision === 'ELIGIBLE TO MODEL' ? <p style={{ marginTop: 10 }}><Link className="btn btn--sm btn--ghost" to={rowModelTo}>Model {row.symbol} DCA / entry amount</Link></p> : null}
            </Card>
          );
        })}
      </div>

      <div className="grid grid--2 section">
        {tactical.map((row) => {
          const tacticalDecision = row.trend.status === 'TREND_LOST' ? 'DO NOT ADD' : row.dip.actionable ? 'WATCH — tactical only' : 'WAIT';
          return (
            <Card key={row.symbol} label={`${row.symbol} · High-risk tactical`} title={tacticalDecision} tone="risk">
              <p className="meta">Daily-reset leverage makes this a tactical instrument, not permanent core exposure. A deep decline does not automatically make it safer to buy.</p>
              <p className="meta">Market health: {plainTrend(row.trend.status)} · {row.dip.declineFromReference == null ? 'Price reference unavailable.' : `Price decline ${formatPct(row.dip.declineFromReference, 1)}.`}</p>
              <p className="meta">Any BUY or SELL must be modeled against the tactical principal watermark, current leverage ceiling and the intended profit-recycling destination.</p>
            </Card>
          );
        })}
      </div>

      <details className="section">
        <summary className="btn btn--ghost">View advanced semiconductor evidence</summary>
        <div style={{ marginTop: 16 }}><Semiconductor /></div>
      </details>
    </>
  );
}
