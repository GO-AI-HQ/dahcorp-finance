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
  const byAccount = p.accounts.map((account) => ({ account, positions: p.positions.filter((position) => position.accountId === account.account.id) }));
  const growthCash = p.accounts.filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible).reduce((sum, row) => sum + row.cash, 0);
  const incomeCash = p.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Income')).reduce((sum, row) => sum + row.cash, 0);
  const maritimeCash = p.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Maritime')).reduce((sum, row) => sum + row.cash, 0);
  const otherCash = p.accounts.filter((row) => !row.account.allocationEligible).reduce((sum, row) => sum + row.cash, 0);

  const growthCandidates = (signals.data?.signals ?? [])
    .filter((row) => row.dip.actionable && row.trend.status === 'TREND_CONFIRMED')
    .sort((a, b) => (b.dip.declineFromReference ?? 0) - (a.dip.declineFromReference ?? 0));
  const bestGrowth = growthCandidates[0] ?? null;
  const semiPulse = intelligence.data?.pulses.find((row) => row.sector === 'semiconductors') ?? null;
  const techPulse = intelligence.data?.pulses.find((row) => row.sector === 'technology') ?? null;
  const policyCaution = semiPulse?.label === 'Cautious' || semiPulse?.policy === 'restrictive';
  const growthDecision = policyCaution
    ? 'HOLD GROWTH CASH — semiconductor policy evidence is restrictive'
    : bestGrowth
      ? `MODEL NEXT GROWTH MOVE — ${bestGrowth.symbol} has a qualified setup`
      : 'HOLD GROWTH CASH — no transaction is required now';
  const growthModelQuestion = bestGrowth
    ? `The strongest qualified Growth price setup is ${bestGrowth.symbol}. Compare buying a specific dollar amount of ${bestGrowth.symbol} with holding Robinhood Growth cash and any stronger eligible alternative. Only recommend a transaction if it improves the Growth mandate after intelligence, overlap and risk.`
    : 'Review the overall Robinhood Growth Treasury. Should I buy, sell, rebalance, or simply hold the Growth Cash Queue now? Do not manufacture a transaction if no setup materially improves the strategy.';

  return (
    <>
      <PageHead
        eyebrow="Portfolio"
        title="Your money and action queue"
        lede="See what you own, which cash each strategy may use, and which decisions are ready for modeling, preview or execution. Growth, Income and Maritime cash are separate mandates."
      />

      <DataBanner containsMockData={p.containsMockData} sourceNotes={p.sourceNotes} asOf={p.asOf} />

      <div className="grid grid--4 section">
        <Card label="Growth Cash Queue" title={formatMoney(growthCash)} action={<Badge tone="intel">Robinhood Agentic</Badge>}><p className="meta">Available only to the Growth mandate. Funding never automatically buys a security.</p></Card>
        <Card label="Income 3085 Cash Queue" title={formatMoney(incomeCash)} action={<Badge tone="ice">Schwab Income</Badge>}><p className="meta">Reserved for YMAG / qualified Income rotations. Maritime cash is excluded.</p></Card>
        <Card label="Maritime Cash Queue" title={formatMoney(maritimeCash)} action={<Badge tone="ice">Schwab Maritime</Badge>}><p className="meta">Reserved for the Shipping accumulation/rotation strategy. It cannot fund Income unless you explicitly transfer/reassign it.</p></Card>
        <Card label="Other broker cash" title={formatMoney(otherCash)} action={<Badge tone="neutral">Visible only</Badge>}><p className="meta">Visible for household awareness but not authorized for a DAHCorp strategy.</p></Card>
      </div>

      <Card label="Growth Treasury Decision" title={growthDecision} tone={policyCaution ? 'risk' : 'default'}>
        <div className="grid grid--3">
          <div className="panel"><span className="soft">Best qualified price setup</span><strong style={{ display: 'block', marginTop: 4 }}>{bestGrowth?.symbol ?? 'None'}</strong><p className="meta">{bestGrowth?.dip.declineFromReference == null ? 'No planned buy-zone setup currently qualifies.' : `${formatPct(bestGrowth.dip.declineFromReference, 1)} below its active reference with confirmed market health.`}</p></div>
          <div className="panel"><span className="soft">Semiconductor intelligence</span><strong style={{ display: 'block', marginTop: 4 }}>{semiPulse?.label ?? 'Not enough evidence'}</strong><p className="meta">Policy {semiPulse?.policy ?? 'unknown'} · news {semiPulse?.newsPressure ?? 'unknown'}.</p></div>
          <div className="panel"><span className="soft">Technology intelligence</span><strong style={{ display: 'block', marginTop: 4 }}>{techPulse?.label ?? 'Not enough evidence'}</strong><p className="meta">This is the overall Growth Treasury view. Ticker-specific decisions live in Growth / Modeling Lab.</p></div>
        </div>
        <div className="banner" style={{ marginTop: 14 }}>
          <strong>Recommended amount comes from Modeling Lab</strong>
          <p className="meta">DAHCorp will not turn a single dip signal into an arbitrary tranche. The Treasury Agent compares holding cash with actual BUY/SELL alternatives and returns a dollar amount only after deterministic validation.</p>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Link to={`/modeling-lab?question=${encodeURIComponent(growthModelQuestion)}`} className="btn btn--sm btn--gold">Build Growth Proposed Model</Link>
          <Link to="/growth?tab=opportunities" className="btn btn--sm btn--ghost">Growth opportunities</Link>
          <Link to="/intelligence" className="btn btn--sm btn--ghost">Market Intelligence</Link>
        </div>
      </Card>

      <div className="section"><YmagTradeCard /></div>
      <div className="section"><NvdyTradeCard /></div>

      <div className="grid grid--2 section">
        <Card label="Investment strategy" title="How portfolio value is currently being used" hint="Percentages below are each strategy's market value divided by total portfolio value, including brokerage cash.">
          <div className="stack stack--tight">
            {p.sleeves.map((sleeve) => (
              <ProgressBar key={sleeve.sleeve} label={`${strategyLabel(sleeve.sleeve)} — ${formatMoney(sleeve.marketValue, 0)}`} value={sleeve.weight} valueLabel={`${formatPct(sleeve.weight, 1)} of total portfolio`} tone={sleeve.overCeiling ? 'risk' : sleeve.sleeve === 'income_engine' ? 'gold' : 'ice'} caption={sleeve.ceiling != null ? `${sleeve.positions} positions · policy maximum ${formatPct(sleeve.ceiling, 0)}` : `${sleeve.positions} positions · ${sleeve.symbols.join(', ')}`} />
            ))}
          </div>
        </Card>

        <Card label="What your money is exposed to" title="Overlapping bets">
          <p className="meta">Different tickers can still depend on the same company, sector or economic driver. This view helps DAHCorp avoid accidentally making the same bet several times.</p>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data"><thead><tr><th>Exposure</th><th>Value</th><th>Share of total</th><th>Symbols</th></tr></thead><tbody>
              {p.exposures.map((exposure) => <tr key={exposure.exposure}><th>{exposure.exposure}</th><td className="num">{formatMoney(exposure.marketValue, 0)}</td><td className="num">{formatPct(exposure.weight, 1)}</td><td>{exposure.symbols.join(', ')}</td></tr>)}
            </tbody></table>
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
              action={<div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Badge tone={account.account.allocationEligible ? 'positive' : 'neutral'} glyph={account.account.allocationEligible ? '✓' : '—'}>{account.account.allocationEligible ? 'Strategy cash authorized' : 'Visible only'}</Badge><Badge tone={account.account.tradeEligible ? 'positive' : 'neutral'} glyph={account.account.tradeEligible ? '✓' : '✕'}>{account.account.tradeEligible ? 'Broker trading available' : 'Trading off'}</Badge></div>}
              hint={account.account.role}
            >
              <div className="row" style={{ gap: 'var(--space-5)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
                <span><span className="soft">Value </span><span className="num">{formatMoney(account.totalValue, 0)}</span></span>
                <span><span className="soft">Cash </span><span className="num">{formatMoney(account.cash)}</span></span>
                <span><span className="soft">Gain / loss </span><span className="num">{basisUnknown ? 'Cost basis unavailable' : `${formatSignedMoney(account.unrealizedPL)} ${formatSignedPct(account.unrealizedPLPct)}`}</span></span>
              </div>

              {positions.length === 0 ? <EmptyState title="No positions in this account">Cash-only account. Nothing is assumed to be held that the broker has not reported.</EmptyState> : (
                <div className="table-wrap">
                  <table className="data"><thead><tr><th>Symbol</th><th>Strategy</th><th>Shares</th><th>Price</th><th>Value</th><th>Cost / share</th><th>Gain / loss</th><th>Share of portfolio</th><th>Today</th></tr></thead><tbody>
                    {positions.map((position) => {
                      const costBasisKnown = !(position.verified && position.marketValue > 0 && position.costBasisTotal === 0);
                      return (
                        <tr key={`${position.accountId}-${position.symbol}`}>
                          <th><span className="symbol">{position.symbol}</span><span className="symbol__name" style={{ display: 'block' }}>{position.name}</span><span className="tag-list">{position.leverage > 1 ? <Badge tone="risk" glyph="!">{position.leverage}× daily</Badge> : null}{position.verified ? <Badge tone="positive" glyph="✓">Ownership confirmed</Badge> : <Badge tone="warning" glyph="▲">{position.verification}</Badge>}{!costBasisKnown ? <Badge tone="warning" glyph="i">Basis unavailable</Badge> : null}</span></th>
                          <td>{strategyLabel(position.sleeve)}</td><td className="num">{formatShares(position.shares)}</td><td className="num">{formatMoney(position.price)}</td><td className="num">{formatMoney(position.marketValue)}</td><td className="num">{costBasisKnown ? formatMoney(position.costBasisPerShare) : '—'}</td><td className="num">{costBasisKnown ? <>{formatSignedMoney(position.unrealizedPL)} <span className="soft">{formatSignedPct(position.unrealizedPLPct)}</span></> : '—'}</td><td className="num">{formatPct(position.weight, 1)}</td><td className="num">{formatSignedPct(position.dayChangePct)}</td>
                        </tr>
                      );
                    })}
                  </tbody></table>
                </div>
              )}

              {account.account.role.includes('Maritime') ? <p style={{ marginTop: 12 }}><Link className="btn btn--sm btn--ghost" to="/growth?tab=shipping">Open Shipping strategy</Link></p> : null}
              {account.account.role.includes('Income') ? <p style={{ marginTop: 12 }}><Link className="btn btn--sm btn--ghost" to="/income">Open Income strategy</Link></p> : null}
            </Card>
          </div>
        );
      })}
    </>
  );
}
