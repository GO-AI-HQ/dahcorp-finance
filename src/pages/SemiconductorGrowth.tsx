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
      ? `${best.symbol} — buy zone reached; evaluate a staged entry`
      : 'WAIT — no core semiconductor entry currently qualifies';

  return (
    <>
      <PageHead
        eyebrow="Growth · Semiconductors"
        title="Semiconductor growth"
        lede="DAHCorp combines price opportunity, market health, policy/news intelligence and available Growth cash before recommending a decision."
        action={<Badge tone={best && !restrictiveIntel ? 'positive' : restrictiveIntel ? 'warning' : 'neutral'}>{best && !restrictiveIntel ? 'Opportunity developing' : 'Watching'}</Badge>}
      />

      <Card label="Current decision" title={headline}>
        <div className="grid grid--4">
          <div className="panel"><span className="soft">Growth Cash Queue</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(growthCash)}</strong><p className="meta">Cash may remain idle indefinitely.</p></div>
          <div className="panel"><span className="soft">Market Intelligence</span><strong style={{ display: 'block', marginTop: 4 }}>{pulse?.label ?? 'Building evidence'}</strong><p className="meta">Policy: {pulse?.policy ?? 'unknown'} · News: {pulse?.newsPressure ?? 'unknown'}</p></div>
          <div className="panel"><span className="soft">Best price setup</span><strong style={{ display: 'block', marginTop: 4 }}>{best?.symbol ?? 'None qualified'}</strong><p className="meta">{best ? `${formatPct(best.dip.declineFromReference ?? 0, 1)} below its reference.` : 'A decline alone is not enough.'}</p></div>
          <div className="panel"><span className="soft">Recommended amount</span><strong style={{ display: 'block', marginTop: 4 }}>Pending Strategy Lab</strong><p className="meta">No arbitrary staged percentage is invented.</p></div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--ghost" to="/strategy-lab">Test in Strategy Lab</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">Open Cash Queue</Link>
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
                ? 'REVIEW ENTRY'
                : 'WAIT';
          return (
            <Card key={row.symbol} label={`${row.symbol} · Core growth`} title={decision} action={<Badge tone={decision === 'REVIEW ENTRY' ? 'positive' : 'neutral'}>{row.dip.actionable ? 'Buy zone reached' : 'No buy zone'}</Badge>}>
              <p><strong>{plainTrend(row.trend.status)}</strong></p>
              <p className="meta">Price {formatMoney(row.price)} · {row.dip.declineFromReference == null ? 'reference unavailable' : `${formatPct(row.dip.declineFromReference, 1)} below reference`}.</p>
              <p className="meta">{row.dip.actionable && row.trend.status === 'TREND_CONFIRMED' ? 'The price has reached a planned entry zone without breaking the deterministic trend framework.' : 'One or more conditions needed for a staged entry are still missing.'}</p>
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
            </Card>
          );
        })}
      </div>

      <details className="section">
        <summary className="btn btn--ghost">View advanced semiconductor evidence</summary>
        <div style={{ marginTop: 16 }}>
          <Semiconductor />
        </div>
      </details>
    </>
  );
}
