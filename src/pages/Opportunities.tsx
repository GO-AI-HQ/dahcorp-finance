import { Fragment, useState } from 'react';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { KeyValue } from '../components/KeyValue.js';
import { DataBanner } from '../components/DataBanner.js';
import { EmptyState, ErrorState, LoadingCards } from '../components/States.js';
import { DipBadge, TrendBadge, VerdictBadge } from '../components/SignalBadges.js';
import { formatMoney, formatNumber, formatPct, formatSignedPct } from '../core/format.js';

export function Opportunities() {
  const signals = useResource(() => api.signals(), []);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (signals.error) return <ErrorState error={signals.error} onRetry={signals.reload} />;
  if (!signals.data) return <LoadingCards count={4} />;

  const d = signals.data;
  const dipCandidates = d.signals.filter((row) => row.dip.levelReached != null);

  return (
    <>
      <PageHead
        eyebrow="Opportunities"
        title="Cash-flow efficiency ranking"
        lede="Ranked by cash flow per risk-adjusted dollar — never by advertised yield. A high headline yield funded by NAV erosion scores badly here, and the reason is always shown."
      />

      <DataBanner containsMockData={d.containsMockData} sourceNotes={d.sourceNotes} asOf={d.asOf} />

      <Card
        label="Ranking"
        title="Income candidates"
        hint="Score components combine distribution cash per invested dollar over 4/13/26/52 weeks, stability, trend, NAV preservation, total return, return-of-capital share, drawdown, spread, liquidity, volatility, correlation and overlap."
      >
        {d.opportunities.length === 0 ? (
          <EmptyState title="No candidates could be scored">
            Scoring needs quotes and distribution history for each candidate.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Score</th>
                  <th scope="col">vs held</th>
                  <th scope="col">Fwd rate</th>
                  <th scope="col">52w total return</th>
                  <th scope="col">NAV 26w</th>
                  <th scope="col">ROC</th>
                  <th scope="col">Overlap</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">
                    <span className="sr-only">Detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.opportunities.map((row) => {
                  const e = row.efficiency;
                  const open = expanded === row.symbol;
                  return (
                    <Fragment key={row.symbol}>
                      <tr>
                        <th scope="row">
                          <span className="symbol">{row.symbol}</span>
                          <span className="symbol__name" style={{ display: 'block' }}>
                            {row.name}
                          </span>
                          {row.held ? (
                            <Badge tone="ice" glyph="●">
                              Held
                            </Badge>
                          ) : null}
                        </th>
                        <td className="num">
                          <strong>{formatNumber(e.score, 1)}</strong>
                        </td>
                        <td className="num">
                          {row.scoreDeltaVsHeld == null ? '—' : `${row.scoreDeltaVsHeld > 0 ? '+' : ''}${formatNumber(row.scoreDeltaVsHeld, 1)}`}
                        </td>
                        <td className="num">{formatPct(e.forwardRate, 1)}</td>
                        <td className="num">{formatSignedPct(e.totalReturn52w, 1)}</td>
                        <td className="num">{formatSignedPct(e.navChange26w, 1)}</td>
                        <td className="num">{formatPct(e.returnOfCapitalPct, 0)}</td>
                        <td className="num">{formatPct(e.overlapPct, 0)}</td>
                        <td>
                          <VerdictBadge verdict={row.verdict} title={row.verdictReason} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : row.symbol)}
                          >
                            {open ? 'Hide' : 'Why'}
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={10}>
                            <p style={{ marginBottom: 'var(--space-3)' }}>{row.verdictReason}</p>
                            <div className="grid grid--2" style={{ gap: 'var(--space-2)' }}>
                              <KeyValue label="Cash per dollar 4w / 13w">
                                {formatPct(e.cashPerDollar4w, 2)} · {formatPct(e.cashPerDollar13w, 2)}
                              </KeyValue>
                              <KeyValue label="Cash per dollar 26w / 52w">
                                {formatPct(e.cashPerDollar26w, 2)} · {formatPct(e.cashPerDollar52w, 2)}
                              </KeyValue>
                              <KeyValue label="Stability / trend">
                                {formatNumber(e.stability, 2)} · {formatSignedPct(e.trend, 1)}
                              </KeyValue>
                              <KeyValue label="Volatility / drawdown 52w">
                                {formatPct(e.volatility, 0)} · {formatPct(e.drawdown52w, 1)}
                              </KeyValue>
                              <KeyValue label="Spread / liquidity">
                                {formatPct(e.spreadPct, 2)} · {formatNumber(e.liquidityScore, 2)}
                              </KeyValue>
                              <KeyValue label="Max correlation to holdings">
                                {formatNumber(e.maxCorrelationToHoldings, 2)}
                              </KeyValue>
                            </div>

                            <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
                              <span>Score components</span>
                            </p>
                            <div className="table-wrap">
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th scope="col">Component</th>
                                    <th scope="col">Raw</th>
                                    <th scope="col">Score</th>
                                    <th scope="col">Weight</th>
                                    <th scope="col">What it measured</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.components.map((component) => (
                                    <tr key={component.key}>
                                      <th scope="row">{component.label}</th>
                                      <td className="num">
                                        {component.raw == null ? '—' : formatNumber(component.raw, 3)}
                                      </td>
                                      <td className="num">{formatNumber(component.score, 2)}</td>
                                      <td className="num">{formatPct(component.weight, 0)}</td>
                                      <td>{component.detail}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {e.warnings.length ? (
                              <ul className="bullets" style={{ marginTop: 'var(--space-3)' }}>
                                {e.warnings.map((warning) => (
                                  <li key={warning}>
                                    <span aria-hidden="true">▲ </span>
                                    {warning}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="section">
        <Card
          label="Dip engine"
          title="Configured dip levels"
          hint={`Measured against the ${d.config.dipReference.replace(/_/g, ' ')} reference at levels ${d.config.dipLevels
            .map((l) => `${(l * 100).toFixed(0)}%`)
            .join(' / ')}. A price decline is not evidence of undervaluation — trend must still hold for a dip to be actionable.`}
        >
          {dipCandidates.length === 0 ? (
            <EmptyState title="No configured dip level is currently met">
              Watchlist symbols are re-evaluated on every load.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Symbol</th>
                    <th scope="col">Price</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Decline</th>
                    <th scope="col">Next level</th>
                    <th scope="col">Trend</th>
                    <th scope="col">Dip</th>
                  </tr>
                </thead>
                <tbody>
                  {dipCandidates.map((row) => (
                    <tr key={row.symbol}>
                      <th scope="row">
                        {row.symbol}
                        {row.held ? <span className="soft"> · held</span> : null}
                      </th>
                      <td className="num">{formatMoney(row.price)}</td>
                      <td className="num">{formatMoney(row.dip.referencePrice)}</td>
                      <td className="num">{formatPct(row.dip.declineFromReference, 1)}</td>
                      <td className="num">
                        {row.dip.nextLevel == null
                          ? '—'
                          : `${formatPct(row.dip.nextLevel, 0)} at ${formatMoney(row.dip.nextLevelPrice)}`}
                      </td>
                      <td>
                        <TrendBadge trend={row.trend} compact />
                      </td>
                      <td>
                        <DipBadge dip={row.dip} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card label="Watchlist" title="Trend status across the universe">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Price</th>
                  <th scope="col">Day</th>
                  <th scope="col">Trend</th>
                  <th scope="col">Checks passed</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {d.signals.map((row) => (
                  <tr key={`watch-${row.symbol}`}>
                    <th scope="row">
                      {row.symbol}
                      {row.held ? (
                        <>
                          {' '}
                          <Badge tone="ice" glyph="●">
                            Held
                          </Badge>
                        </>
                      ) : null}
                    </th>
                    <td className="num">{formatMoney(row.price)}</td>
                    <td className="num">{formatSignedPct(row.dayChangePct)}</td>
                    <td>
                      <TrendBadge trend={row.trend} compact />
                    </td>
                    <td className="num">
                      {row.trend.passed}/{row.trend.evaluable}
                    </td>
                    <td>{row.trend.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
