import { api } from '../services/api.js';
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

export function Portfolio() {
  const portfolio = useResource(() => api.portfolio(), []);

  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!portfolio.data) return <LoadingCards count={4} />;

  const p = portfolio.data;
  const exposureScopeLabel = p.scopeOptions.find((o) => o.scope === p.exposureScope)?.label ?? 'portfolio';
  const riskExposureWeight = new Map<string, number>(p.riskExposures.map((e) => [e.exposure, e.weight] as const));
  const byAccount = p.accounts.map((account) => ({
    account,
    positions: p.positions.filter((position) => position.accountId === account.account.id),
  }));

  return (
    <>
      <PageHead
        eyebrow="Portfolio"
        title="Holdings & sleeves"
        lede="Every position is classified into a sleeve so concentration, leverage and purpose are visible rather than implied."
      />

      <DataBanner containsMockData={p.containsMockData} sourceNotes={p.sourceNotes} asOf={p.asOf} />

      <div className="section"><YmagTradeCard /></div>
      <div className="section"><NvdyTradeCard /></div>

      <div className="grid grid--2 section">
        <Card label="Sleeves" title="Capital by purpose">
          <div className="stack stack--tight">
            {p.sleeves.map((sleeve) => (
              <ProgressBar
                key={sleeve.sleeve}
                label={`${SLEEVE_LABELS[sleeve.sleeve]} — ${formatMoney(sleeve.marketValue, 0)}`}
                value={sleeve.weight}
                valueLabel={formatPct(sleeve.weight, 1)}
                tone={sleeve.overCeiling ? 'risk' : sleeve.sleeve === 'income_engine' ? 'gold' : 'ice'}
                caption={
                  sleeve.ceiling != null
                    ? `${sleeve.positions} positions · ceiling ${formatPct(sleeve.ceiling, 0)}${sleeve.overCeiling ? ' — over ceiling' : ''}`
                    : `${sleeve.positions} positions · ${sleeve.symbols.join(', ')}`
                }
              />
            ))}
          </div>
        </Card>

        <Card
          label="Exposure"
          title="Underlying concentration"
          hint={
            <>
              Two different tickers can be the same bet. This groups by underlying exposure rather than by symbol. The
              ceiling itself is enforced against {exposureScopeLabel.toLowerCase()} capital, which is what the badges
              below report.
            </>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">Exposure</th><th scope="col">Value</th><th scope="col">Weight</th><th scope="col">Symbols</th></tr></thead>
              <tbody>
                {p.exposures.map((exposure) => (
                  <tr key={exposure.exposure}>
                    <th scope="row">{exposure.exposure}</th>
                    <td className="num">{formatMoney(exposure.marketValue, 0)}</td>
                    <td className="num">
                      {formatPct(exposure.weight, 1)}
                      {(riskExposureWeight.get(exposure.exposure) ?? 0) > p.config.maxSingleExposurePct ? (
                        <>
                          {' '}
                          <Badge tone="negative" glyph="!" title={`${formatPct(riskExposureWeight.get(exposure.exposure) ?? 0, 1)} of ${exposureScopeLabel} capital, against a ${formatPct(p.config.maxSingleExposurePct, 0)} ceiling.`}>Over limit</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{exposure.symbols.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {byAccount.map(({ account, positions }) => (
        <div key={account.account.id} className="section">
          <Card
            label={`${account.account.broker} · ${account.account.type}`}
            title={account.account.name}
            action={
              <div className="row" style={{ gap: 8 }}>
                <Badge tone={account.account.allocationEligible ? 'positive' : 'neutral'} glyph={account.account.allocationEligible ? '✓' : '—'}>
                  {account.account.allocationEligible ? 'Allocation eligible' : 'Not auto-allocated'}
                </Badge>
                <Badge tone={account.account.tradeEligible ? 'positive' : 'neutral'} glyph={account.account.tradeEligible ? '✓' : '✕'}>
                  {account.account.tradeEligible ? 'Trading eligible' : 'Trading off'}
                </Badge>
                {account.account.dataQuality === 'mock' ? <Badge tone="warning" glyph="▲">Mock</Badge> : null}
              </div>
            }
            hint={account.account.role}
          >
            <div className="row" style={{ gap: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
              <span><span className="soft">Value </span><span className="num">{formatMoney(account.totalValue, 0)}</span></span>
              <span><span className="soft">Cash </span><span className="num">{formatMoney(account.cash)}</span></span>
              <span><span className="soft">Unrealized </span><span className="num">{formatSignedMoney(account.unrealizedPL)} {formatSignedPct(account.unrealizedPLPct)}</span></span>
            </div>

            {positions.length === 0 ? (
              <EmptyState title="No positions in this account">Cash-only account. Nothing is assumed to be held that the broker has not reported.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th scope="col">Symbol</th><th scope="col">Sleeve</th><th scope="col">Shares</th><th scope="col">Price</th><th scope="col">Value</th><th scope="col">Cost / share</th><th scope="col">Unrealized</th><th scope="col">Weight</th><th scope="col">Day</th></tr></thead>
                  <tbody>
                    {positions.map((position) => (
                      <tr key={`${position.accountId}-${position.symbol}`}>
                        <th scope="row">
                          <span className="symbol">{position.symbol}</span>
                          <span className="symbol__name" style={{ display: 'block' }}>{position.name}</span>
                          <span className="tag-list">
                            {position.leverage > 1 ? <Badge tone="risk" glyph="!">{position.leverage}× daily</Badge> : null}
                            {position.legacy ? <Badge tone="neutral" glyph="·">Legacy</Badge> : null}
                            {position.verified ? (
                              <Badge tone="positive" glyph="✓" title="Ownership and cost basis are confirmed. This position may drive live decisions.">Confirmed</Badge>
                            ) : (
                              <Badge tone="warning" glyph="▲" title="Demonstration fixture. It illustrates the calculations but cannot trigger a live risk, concentration, harvest or allocation decision until a brokerage adapter verifies ownership and cost basis.">{position.verification}</Badge>
                            )}
                          </span>
                        </th>
                        <td>{SLEEVE_LABELS[position.sleeve]}</td>
                        <td className="num">{formatShares(position.shares)}</td>
                        <td className="num">{formatMoney(position.price)}</td>
                        <td className="num">{formatMoney(position.marketValue)}</td>
                        <td className="num">{formatMoney(position.costBasisPerShare)}</td>
                        <td className="num">{formatSignedMoney(position.unrealizedPL)} <span className="soft">{formatSignedPct(position.unrealizedPLPct)}</span></td>
                        <td className="num">{formatPct(position.weight, 1)}</td>
                        <td className="num">{formatSignedPct(position.dayChangePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ))}
    </>
  );
}
