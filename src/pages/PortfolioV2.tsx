import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { intelligenceApi } from '../services/intelligenceApi.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { DataBanner } from '../components/DataBanner.js';
import { YmagTradeCard } from '../components/YmagTradeCard.js';
import { NvdyTradeCard } from '../components/NvdyTradeCard.js';
import { EmptyState, ErrorState, LoadingCards } from '../components/States.js';
import { SLEEVE_LABELS } from '../core/universe.js';
import { formatMoney, formatPct, formatShares, formatSignedMoney, formatSignedPct } from '../core/format.js';

function strategyLabel(sleeve: string): string {
  const map: Record<string, string> = {
    income_engine: 'Income',
    core_growth: 'Core growth',
    tactical_leveraged: 'Tactical growth',
    shipping_cyclical: 'Cyclical / shipping',
    reit_dividend: 'Dividend / real estate',
    future_education: 'Education',
    cash: 'Cash',
    unclassified: 'Other',
  };
  return map[sleeve] ?? SLEEVE_LABELS[sleeve as keyof typeof SLEEVE_LABELS] ?? sleeve;
}

export function PortfolioV2() {
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);
  const intelligence = useResource(() => intelligenceApi.current(), []);

  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!portfolio.data) return <LoadingCards count={5} />;

  const p = portfolio.data;
  const byAccount = p.accounts.map((account) => ({
    account,
    positions: p.positions.filter((position) => position.accountId === account.account.id),
  }));
  const growthCash = p.accounts
    .filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const incomeCash = p.accounts
    .filter((row) => row.account.broker === 'schwab' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const otherCash = p.accounts
    .filter((row) => !row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);

  const semiSignal = signals.data?.signals.find((row) => row.symbol === 'SEMI') ?? null;
  const semiPulse = intelligence.data?.pulses.find((row) => row.sector === 'semiconductors') ?? null;
  const policyCaution = semiPulse?.label === 'Cautious' || semiPulse?.policy === 'restrictive';
  const buyZone = Boolean(semiSignal?.dip?.actionable);
  const healthyTrend = semiSignal?.trend?.status === 'TREND_CONFIRMED';
  const growthDecision = policyCaution
    ? 'WAIT — policy evidence argues for caution'
    : buyZone && healthyTrend
      ? 'REVIEW ENTRY — SEMI buy zone reached'
      : 'WAIT — no Growth purchase is required now';

  return (
    <>
      <PageHead
        eyebrow="Portfolio"
        title="Your money and action queue"
        lede="See what you own, which cash each strategy may use, and which decisions are ready for simulation, preview or execution. Broker visibility does not automatically give the agent spending authority."
      />

      <DataBanner containsMockData={p.containsMockData} sourceNotes={p.sourceNotes} asOf={p.asOf} />

      <div className="grid grid--3 section">
        <Card label="Growth Cash Queue" title={formatMoney(growthCash)} action={<Badge tone="intel">Robinhood Agentic</Badge>}>
          <p className="meta">Available to the Growth mandate. Funding the account never automatically buys a security.</p>
        </Card>
        <Card label="Income Cash Queue" title={formatMoney(incomeCash)} action={<Badge tone="ice">Schwab Income</Badge>}>
          <p className="meta">Only the Schwab account designated by the Income strategy contributes to this queue.</p>
        </Card>
        <Card label="Other broker cash" title={formatMoney(otherCash)} action={<Badge tone="neutral">Not agent-authorized</Badge>}>
          <p className="meta">Visible for household awareness, but excluded from automated allocation.</p>
        </Card>
      </div>

      <Card label="Current Growth decision" title={growthDecision} tone={policyCaution ? 'risk' : 'default'}>
        <div className="grid grid--3">
          <div className="panel">
            <span className="soft">Price opportunity</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{buyZone ? 'Buy zone reached' : 'No planned buy zone yet'}</strong>
            <p className="meta">{semiSignal?.dip.declineFromReference == null ? 'Waiting for a usable price reference.' : `${formatPct(semiSignal.dip.declineFromReference, 1)} below the active reference.`}</p>
          </div>
          <div className="panel">
            <span className="soft">Market health</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{healthyTrend ? 'Healthy enough to evaluate' : semiSignal?.trend.status ?? 'Unknown'}</strong>
            <p className="meta">Advanced trend evidence remains available inside Growth.</p>
          </div>
          <div className="panel">
            <span className="soft">Policy / news</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{semiPulse?.label ?? 'Not enough intelligence yet'}</strong>
            <p className="meta">Market Intelligence can delay or strengthen a setup; it cannot override deterministic risk rules.</p>
          </div>
        </div>
        <div className="banner" style={{ marginTop: 14 }}>
          <strong>Recommended amount: not yet authorized</strong>
          <p className="meta">DAHCorp will not invent a staged dollar amount. Strategy Lab and the Treasury Agent must compare the setup against holding cash before a dollar recommendation reaches this queue.</p>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Link to="/growth?tab=semiconductors" className="btn btn--sm btn--ghost">Why / evidence</Link>
          <Link to="/strategy-lab" className="btn btn--sm btn--ghost">Strategy Lab</Link>
          <Link to="/intelligence" className="btn btn--sm btn--ghost">Market Intelligence</Link>
        </div>
      </Card>

      <div className="section"><YmagTradeCard /></div>
      <div className="section"><NvdyTradeCard /></div>

      <div className="grid grid--2 section">
        <Card label="Investment strategy" title="How portfolio value is currently being used" hint="Percentages below are each strategy's market value divided by total portfolio value, including brokerage cash. Change the calculation scope elsewhere when you want a different denominator.">
          <div className="stack stack--tight">
            {p.sleeves.map((sleeve) => (
              <ProgressBar
                key={sleeve.sleeve}
                label={`${strategyLabel(sleeve.sleeve)} — ${formatMoney(sleeve.marketValue, 0)}`}
                value={sleeve.weight}
                valueLabel={`${formatPct(sleeve.weight, 1)} of total portfolio`}
                tone={sleeve.overCeiling ? 'risk' : sleeve.sleeve === 'income_engine' ? 'gold' : 'ice'}
                caption={sleeve.ceiling != null ? `${sleeve.positions} positions · policy maximum ${formatPct(sleeve.ceiling, 0)}` : `${sleeve.positions} positions · ${sleeve.symbols.join(', ')}`}
              />
            ))}
          </div>
        </Card>

        <Card label="What your money is exposed to" title="Overlapping bets">
          <p className="meta">Different tickers can still depend on the same company, sector or economic driver. This view helps DAHCorp avoid accidentally making the same bet several times.</p>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead><tr><th>Exposure</th><th>Value</th><th>Share of total</th><th>Symbols</th></tr></thead>
              <tbody>
                {p.exposures.map((exposure) => (
                  <tr key={exposure.exposure}>
                    <th>{exposure.exposure}</th>
                    <td className="num">{formatMoney(exposure.marketValue, 0)}</td>
                    <td className="num">{formatPct(exposure.weight, 1)}</td>
                    <td>{exposure.symbols.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {byAccount.map(({ account, positions }) => {
        const basisUnknown = positions.some((position) => position.verified && position.marketValue > 0 && position.costBasisTotal === 0);
        return (
          <div key={account.account.id} className="section">
            <Card
              label={`${account.account.broker} · ${account.account.type}`}
              title={account.account.name}
              action={
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone={account.account.allocationEligible ? 'positive' : 'neutral'} glyph={account.account.allocationEligible ? '✓' : '—'}>
                    {account.account.allocationEligible ? 'Strategy cash authorized' : 'Visible only'}
                  </Badge>
                  <Badge tone={account.account.tradeEligible ? 'positive' : 'neutral'} glyph={account.account.tradeEligible ? '✓' : '✕'}>
                    {account.account.tradeEligible ? 'Broker trading available' : 'Trading off'}
                  </Badge>
                </div>
              }
              hint={account.account.role}
            >
              <div className="row" style={{ gap: 'var(--space-5)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
                <span><span className="soft">Value </span><span className="num">{formatMoney(account.totalValue, 0)}</span></span>
                <span><span className="soft">Cash </span><span className="num">{formatMoney(account.cash)}</span></span>
                <span><span className="soft">Gain / loss </span><span className="num">{basisUnknown ? 'Cost basis unavailable' : `${formatSignedMoney(account.unrealizedPL)} ${formatSignedPct(account.unrealizedPLPct)}`}</span></span>
              </div>

              {positions.length === 0 ? (
                <EmptyState title="No positions in this account">Cash-only account. Nothing is assumed to be held that the broker has not reported.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Symbol</th><th>Strategy</th><th>Shares</th><th>Price</th><th>Value</th><th>Cost / share</th><th>Gain / loss</th><th>Share of portfolio</th><th>Today</th></tr></thead>
                    <tbody>
                      {positions.map((position) => {
                        const costBasisKnown = !(position.verified && position.marketValue > 0 && position.costBasisTotal === 0);
                        return (
                          <tr key={`${position.accountId}-${position.symbol}`}>
                            <th>
                              <span className="symbol">{position.symbol}</span>
                              <span className="symbol__name" style={{ display: 'block' }}>{position.name}</span>
                              <span className="tag-list">
                                {position.leverage > 1 ? <Badge tone="risk" glyph="!">{position.leverage}× daily</Badge> : null}
                                {position.verified ? <Badge tone="positive" glyph="✓">Ownership confirmed</Badge> : <Badge tone="warning" glyph="▲">{position.verification}</Badge>}
                                {!costBasisKnown ? <Badge tone="warning" glyph="i">Basis unavailable</Badge> : null}
                              </span>
                            </th>
                            <td>{strategyLabel(position.sleeve)}</td>
                            <td className="num">{formatShares(position.shares)}</td>
                            <td className="num">{formatMoney(position.price)}</td>
                            <td className="num">{formatMoney(position.marketValue)}</td>
                            <td className="num">{costBasisKnown ? formatMoney(position.costBasisPerShare) : '—'}</td>
                            <td className="num">{costBasisKnown ? <>{formatSignedMoney(position.unrealizedPL)} <span className="soft">{formatSignedPct(position.unrealizedPLPct)}</span></> : '—'}</td>
                            <td className="num">{formatPct(position.weight, 1)}</td>
                            <td className="num">{formatSignedPct(position.dayChangePct)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        );
      })}
    </>
  );
}
