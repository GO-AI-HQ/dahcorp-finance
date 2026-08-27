import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { StatCard } from '../components/StatCard.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { DataBanner } from '../components/DataBanner.js';
import { KeyValue } from '../components/KeyValue.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { SeverityBadge } from '../components/SignalBadges.js';
import { ValueAreaChart } from '../charts/ValueAreaChart.js';
import {
  formatMoney,
  formatMoneyCompact,
  formatMonths,
  formatPct,
  formatShares,
  formatSignedMoney,
  formatSignedPct,
} from '../core/format.js';
import { DISTRIBUTION_BASIS_LABELS } from '../core/config.js';

export function Overview() {
  const portfolio = useResource(() => api.portfolio(), []);
  const income = useResource(() => api.income(), []);
  const signals = useResource(() => api.signals(), []);

  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!portfolio.data) return <LoadingCards count={8} />;

  const p = portfolio.data;
  const s = p.incomeSummary;
  const milestone = p.milestones.find((m) => m.id === p.config.activeMilestoneId) ?? p.milestones[0];
  const robinhood = p.accounts.filter((a) => a.account.broker === 'robinhood');
  const schwab = p.accounts.filter((a) => a.account.broker === 'schwab');
  const brokerValue = (rows: typeof p.accounts) => rows.reduce((acc, r) => acc + r.totalValue, 0);
  const eta = p.velocity.linearMonthsToMilestone;
  const selfFunding = income.data?.income.selfFundingMilestone ?? null;
  const drag = signals.data?.drag ?? [];

  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="Capital position"
        lede={
          <>
            Level {p.strategyLevel.level} — {p.strategyLevel.name}. {p.strategyLevel.goal}
          </>
        }
        action={
          <Badge tone="intel" glyph="◆" title="Execution phase in force">
            Phase 1 · Observer
          </Badge>
        }
      />

      <DataBanner containsMockData={p.containsMockData} sourceNotes={p.sourceNotes} asOf={p.asOf} />

      <div className="grid grid--4 section">
        <StatCard
          label="Portfolio value"
          value={formatMoney(p.totals.totalValue, 0)}
          tone="gold"
          delta={`${formatSignedMoney(p.totals.unrealizedPL, 0)} unrealized`}
          deltaDirection={p.totals.unrealizedPL > 0 ? 'up' : p.totals.unrealizedPL < 0 ? 'down' : 'flat'}
          caption={`Cash ${formatMoney(p.totals.totalCash)} · invested ${formatMoney(p.totals.totalInvested, 0)}`}
        />
        <StatCard
          label="Robinhood"
          value={formatMoney(brokerValue(robinhood), 0)}
          caption={`${robinhood.reduce((a, r) => a + r.positionCount, 0)} positions · Active Accumulation`}
        />
        <StatCard
          label="Charles Schwab"
          value={formatMoney(brokerValue(schwab), 0)}
          caption={`${schwab.reduce((a, r) => a + r.positionCount, 0)} positions · Income / Value / Cyclical`}
        />
        <StatCard
          label="Income engine capital"
          value={formatMoney(s.incomeEngineCapital, 0)}
          tone="ice"
          caption={
            s.blendedDistributionRate != null
              ? `Blended modeled rate ${formatPct(s.blendedDistributionRate, 1)} · ${DISTRIBUTION_BASIS_LABELS[p.config.distributionBasis]}`
              : 'No modeled rate yet'
          }
        />

        <StatCard
          label="Distributions received (30d)"
          value={formatMoney(s.received30d)}
          badge={{ text: 'Received', tone: 'positive', glyph: '✓' }}
          caption={`Lifetime ${formatMoney(s.receivedLifetime)} · 7d ${formatMoney(s.received7d)}`}
        />
        <StatCard
          label="Forward monthly income"
          value={formatMoney(s.forwardMonthlyIncome)}
          badge={{ text: 'Modeled', tone: 'ice', glyph: 'i' }}
          caption={
            <>
              Conservative {formatMoney(s.conservativeMonthlyIncome)} after a {formatPct(p.config.conservativeHaircut, 0)}{' '}
              haircut.{' '}
              {s.estimatedEconomicIncomeMonthly != null
                ? `Approx. ${formatMoney(s.estimatedEconomicIncomeMonthly)}/mo is economic income after estimated return of capital.`
                : 'Return-of-capital share unreported for these positions.'}
            </>
          }
        />
        <StatCard
          label={`${formatMoney(milestone.targetMonthlyIncome, 0)}/mo goal`}
          value={formatPct(Math.min(milestone.progress, 1), 1)}
          tone="gold"
          caption={
            milestone.requiredCapital != null
              ? `Needs ~${formatMoneyCompact(milestone.requiredCapital)} of income capital at the modeled rate (${formatMoneyCompact(milestone.capitalGap ?? 0)} to go).`
              : 'Required capital cannot be modeled without a distribution rate.'
          }
        />
        <StatCard
          label="Estimated time to goal"
          value={eta == null ? '—' : formatMonths(eta)}
          badge={{ text: 'Projection', tone: 'warning', glyph: '▲' }}
          caption={
            eta == null
              ? 'Current income velocity is not positive, so no arrival date can be derived.'
              : `At the current velocity of ${formatMoney(p.velocity.total)}/mo of new monthly income. Not a guarantee.`
          }
        />
      </div>

      <div className="grid grid--wide-left section">
        <Card
          label="Portfolio value"
          title="Value of current positions"
          hint="Today's share counts repriced against historical closes — a position-value series, not a transaction-accurate equity curve."
        >
          {p.valueHistory.length > 1 ? (
            <ValueAreaChart data={p.valueHistory} />
          ) : (
            <p className="meta">Not enough price history yet to draw a series.</p>
          )}
        </Card>

        <Card label="Milestones" title="Income ladder">
          <div className="stack stack--tight">
            {p.milestones.map((m) => (
              <ProgressBar
                key={m.id}
                label={`${formatMoney(m.targetMonthlyIncome, 0)}/mo`}
                value={m.progress}
                valueLabel={m.reached ? 'Reached' : formatPct(m.progress, 1)}
                tone={m.reached ? 'positive' : m.id === p.config.activeMilestoneId ? 'gold' : 'ice'}
                caption={
                  m.requiredCapital != null
                    ? `≈ ${formatMoneyCompact(m.requiredCapital)} income capital (${formatMoneyCompact(m.requiredCapitalConservative ?? 0)} conservative)`
                    : undefined
                }
              />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card
          label="Self-funding milestone"
          title="When the engine buys its own shares"
          hint="Recomputed from current prices and distributions every load. The share counts move as prices and payouts move."
        >
          {selfFunding && selfFunding.perSymbol.length ? (
            <div className="stack stack--tight">
              <ProgressBar
                label="Combined progress to one self-bought share per month"
                value={selfFunding.combinedProgress}
                tone={selfFunding.allSelfFunding ? 'positive' : 'gold'}
                caption={`Total capital required ≈ ${formatMoney(selfFunding.totalCapitalRequired, 0)} across ${selfFunding.perSymbol.length} positions.`}
              />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Symbol</th>
                      <th scope="col">Shares</th>
                      <th scope="col">Needed</th>
                      <th scope="col">Remaining</th>
                      <th scope="col">Capital</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selfFunding.perSymbol.map((row) => (
                      <tr key={row.symbol}>
                        <th scope="row">{row.symbol}</th>
                        <td className="num">{formatShares(row.shares)}</td>
                        <td className="num">{row.sharesRequired == null ? '—' : formatShares(row.sharesRequired)}</td>
                        <td className="num">{row.sharesRemaining == null ? '—' : formatShares(row.sharesRemaining)}</td>
                        <td className="num">{formatMoney(row.capitalRequired, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : income.error ? (
            <ErrorState error={income.error} onRetry={income.reload} />
          ) : (
            <p className="meta">Loading distribution history…</p>
          )}
        </Card>

        <Card label="Income velocity" title="Where new income is coming from">
          <div className="stack stack--tight">
            <KeyValue label="From contributions" hint="per month">
              {formatMoney(p.velocity.contributionDriven)}
            </KeyValue>
            <KeyValue label="From DRIP" hint="per month">
              {formatMoney(p.velocity.dripDriven)}
            </KeyValue>
            <KeyValue label="From market / rate drift" hint="residual">
              {p.priorSnapshotAsOf ? formatSignedMoney(p.velocity.marketDriven) : 'Unavailable'}
            </KeyValue>
            <KeyValue label="Total velocity">
              <strong>{formatMoney(p.velocity.total)}/mo</strong>
            </KeyValue>
            {p.velocity.notes.map((note) => (
              <p key={note} className="meta">
                {note}
              </p>
            ))}
            <p className="meta">
              <Link to="/income">Open the Income Engine →</Link>
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Risk posture" title="Deterministic limits">
          <div className="stack stack--tight">
            <ProgressBar
              label="Leveraged sleeve"
              value={p.leveraged.maxPct > 0 ? p.leveraged.pct / p.leveraged.maxPct : 0}
              valueLabel={`${formatPct(p.leveraged.pct, 1)} of ${formatPct(p.leveraged.maxPct, 0)}`}
              tone="risk"
              caption={`${formatMoney(p.leveraged.value, 0)} in daily-reset leveraged products. 2× and 3× are daily multiples, never long-term multiples.`}
            />
            <KeyValue label="Liquidity reserve" hint="never recommended for investment">
              {formatMoney(p.totals.reservedCash, 0)} of {formatMoney(p.config.liquidityReserve, 0)}
            </KeyValue>
            <KeyValue label="Investable cash">{formatMoney(p.totals.investableCash)}</KeyValue>
            {p.concentrationBreaches.length ? (
              <ul className="bullets">
                {p.concentrationBreaches.map((b) => (
                  <li key={b.symbol}>
                    {b.symbol} is {formatPct(b.weight, 1)} of the portfolio against a {formatPct(b.limit, 0)} limit.
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">No position or exposure limit is currently breached.</p>
            )}
          </div>
        </Card>

        <Card label="Drag analysis" title="What is slowing the engine" tone={drag.length ? 'risk' : 'default'}>
          {signals.error ? (
            <ErrorState error={signals.error} onRetry={signals.reload} />
          ) : !signals.data ? (
            <p className="meta">Evaluating deterministic signals…</p>
          ) : drag.length === 0 ? (
            <p className="meta">No material drag detected against the current milestone.</p>
          ) : (
            <ul className="list-reset stack stack--tight">
              {drag.slice(0, 5).map((item) => (
                <li key={item.title}>
                  <div className="row" style={{ gap: 8 }}>
                    <SeverityBadge severity={item.severity} />
                    <strong>{item.title}</strong>
                  </div>
                  <p className="meta">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Accounts" title="By account">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Value</th>
                  <th scope="col">Cash</th>
                  <th scope="col">Unrealized</th>
                  <th scope="col">Allocation</th>
                </tr>
              </thead>
              <tbody>
                {p.accounts.map((row) => (
                  <tr key={row.account.id}>
                    <th scope="row">
                      {row.account.name}
                      <span className="soft" style={{ display: 'block', fontSize: '0.76rem' }}>
                        {row.account.broker} · {row.account.type}
                      </span>
                    </th>
                    <td className="num">{formatMoney(row.totalValue, 0)}</td>
                    <td className="num">{formatMoney(row.cash)}</td>
                    <td className="num">
                      {formatSignedMoney(row.unrealizedPL)}{' '}
                      <span className="soft">{formatSignedPct(row.unrealizedPLPct)}</span>
                    </td>
                    <td>
                      {row.account.allocationEligible ? (
                        <Badge tone="positive" glyph="✓">
                          Eligible
                        </Badge>
                      ) : (
                        <Badge tone="neutral" glyph="—">
                          Excluded
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card label="Brokers" title="Connection status">
          <div className="stack stack--tight">
            {p.brokers.map((broker) => (
              <div key={broker.id}>
                <div className="row" style={{ gap: 8 }}>
                  <strong>{broker.label}</strong>
                  <Badge tone={broker.configured ? 'positive' : 'warning'} glyph={broker.configured ? '✓' : '▲'}>
                    {broker.mode}
                  </Badge>
                  <Badge tone="neutral" glyph="✕">
                    Execution off
                  </Badge>
                </div>
                <p className="meta">{broker.note}</p>
              </div>
            ))}
            {p.configNote ? <p className="meta">{p.configNote}</p> : null}
          </div>
        </Card>
      </div>
    </>
  );
}
