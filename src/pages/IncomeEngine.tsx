import { useState } from 'react';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { StatCard } from '../components/StatCard.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { KeyValue } from '../components/KeyValue.js';
import { DataBanner } from '../components/DataBanner.js';
import { EmptyState, ErrorState, LoadingCards } from '../components/States.js';
import { IncomeBarChart } from '../charts/IncomeBarChart.js';
import { DistributionSparkline } from '../charts/DistributionSparkline.js';
import { DISTRIBUTION_BASIS_LABELS, type DistributionBasis } from '../core/config.js';
import {
  formatMoney,
  formatMoneyCompact,
  formatMonths,
  formatNumber,
  formatPct,
  formatShares,
  formatSignedMoney,
  formatSignedPct,
} from '../core/format.js';

const BASES: DistributionBasis[] = ['latest', 'avg4w', 'avg13w', 'avg26w', 'avg52w'];

export function IncomeEngine() {
  const [nonce, setNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const income = useResource(() => api.income(), [nonce]);

  async function changeBasis(basis: DistributionBasis) {
    setSaving(true);
    setSaveNote(null);
    try {
      const result = await api.saveSettings({ distributionBasis: basis });
      setSaveNote(result.persisted ? null : (result.note ?? 'Change applied for this session only.'));
      setNonce((n) => n + 1);
    } catch {
      setSaveNote('Could not change the distribution basis.');
    } finally {
      setSaving(false);
    }
  }

  if (income.error) return <ErrorState error={income.error} onRetry={income.reload} />;
  if (!income.data) return <LoadingCards count={4} />;

  const d = income.data;
  const s = d.income;
  const milestone = d.milestones.find((m) => m.id === d.config.activeMilestoneId) ?? d.milestones[0];
  const seriesFor = (symbol: string) => d.weeklySeries.find((w) => w.symbol === symbol)?.series ?? [];

  return (
    <>
      <PageHead
        eyebrow="Income Engine"
        title="Cash-flow production"
        lede="Modeled forward income is an estimate built from trailing distribution history. Cash received is audited fact. The two are never merged."
      />

      <DataBanner containsMockData={d.containsMockData} sourceNotes={d.sourceNotes} asOf={d.asOf} />

      <Card label="Distribution basis" title="Modeling window" tight>
        <div className="chip-group" role="group" aria-label="Distribution basis">
          {BASES.map((basis) => (
            <button
              key={basis}
              type="button"
              className="chip"
              aria-pressed={d.config.distributionBasis === basis}
              disabled={saving}
              onClick={() => void changeBasis(basis)}
            >
              {DISTRIBUTION_BASIS_LABELS[basis]}
            </button>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 10 }}>
          Every forward figure below is modeled on the {DISTRIBUTION_BASIS_LABELS[d.config.distributionBasis].toLowerCase()}{' '}
          distribution, then shown again after a {formatPct(s.haircut, 0)} conservative haircut.
          {saveNote ? ` ${saveNote}` : ''}
        </p>
      </Card>

      <div className="grid grid--4 section">
        <StatCard
          label="Forward monthly income"
          value={formatMoney(s.forwardMonthlyIncome)}
          tone="gold"
          badge={{ text: 'Modeled', tone: 'ice', glyph: 'i' }}
          caption={`Weekly ${formatMoney(s.forwardWeeklyIncome)} · annual ${formatMoney(s.forwardAnnualIncome, 0)}`}
        />
        <StatCard
          label="Conservative monthly"
          value={formatMoney(s.conservativeMonthlyIncome)}
          caption={`After the ${formatPct(s.haircut, 0)} haircut. Use this figure for planning.`}
        />
        <StatCard
          label="Economic income (est.)"
          value={s.estimatedEconomicIncomeMonthly == null ? '—' : formatMoney(s.estimatedEconomicIncomeMonthly)}
          badge={{ text: 'ROC-adjusted', tone: 'warning', glyph: '▲' }}
          caption={
            s.estimatedEconomicIncomeMonthly == null
              ? 'No position reports its return-of-capital share, so economic income cannot be estimated.'
              : 'Modeled income less the estimated return-of-capital portion. Cash received is not automatically profit.'
          }
        />
        <StatCard
          label="Received (30d)"
          value={formatMoney(s.received30d)}
          tone="ice"
          badge={{ text: 'Actual', tone: 'positive', glyph: '✓' }}
          caption={`90d ${formatMoney(s.received90d)} · lifetime ${formatMoney(s.receivedLifetime)}`}
        />
      </div>

      {s.flags.length ? (
        <div className="banner banner--risk section" role="note">
          <span className="banner__glyph" aria-hidden="true">
            ▲
          </span>
          <div>
            <span className="banner__title">Read these alongside the income figures</span>
            <ul className="bullets">
              {s.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="grid grid--wide-left section">
        <Card
          label="Received distributions"
          title="Cash actually paid, by month"
          hint="Audited from income events, not modeled. Early months reflect smaller share counts."
        >
          {d.monthlyReceived.length ? (
            <IncomeBarChart data={d.monthlyReceived} />
          ) : (
            <EmptyState title="No distributions recorded yet">
              Once payments land they are recorded per account, per symbol, per pay date.
            </EmptyState>
          )}
        </Card>

        <Card label="Goal" title={`${formatMoney(milestone.targetMonthlyIncome, 0)}/mo`}>
          <div className="stack stack--tight">
            <ProgressBar
              label="Progress on modeled income"
              value={milestone.progress}
              valueLabel={milestone.reached ? 'Reached' : formatPct(milestone.progress, 1)}
              tone={milestone.reached ? 'positive' : 'gold'}
            />
            <KeyValue label="Required capital" hint="at the modeled rate">
              {formatMoneyCompact(d.requiredCapital)}
            </KeyValue>
            <KeyValue label="Required capital" hint="conservative rate">
              {formatMoneyCompact(d.requiredCapitalConservative)}
            </KeyValue>
            <KeyValue label="Income capital today">{formatMoney(s.incomeEngineCapital, 0)}</KeyValue>
            <KeyValue label="Capital gap">{formatMoneyCompact(milestone.capitalGap ?? 0)}</KeyValue>
            <KeyValue label="Blended modeled rate">{formatPct(s.blendedDistributionRate, 1)}</KeyValue>
            <p className="meta">
              Required capital is <code>target × 12 ÷ modeled rate</code>. It moves whenever the rate moves — it is not a
              fixed dollar figure.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Income velocity" title="New monthly income added per month">
          <div className="stack stack--tight">
            <KeyValue label="Contributions">{formatMoney(d.velocity.contributionDriven)}</KeyValue>
            <KeyValue label="DRIP / compounding">{formatMoney(d.velocity.dripDriven)}</KeyValue>
            <KeyValue label="Market & rate drift">{formatSignedMoney(d.velocity.marketDriven)}</KeyValue>
            <KeyValue label="Total">
              <strong>{formatMoney(d.velocity.total)}/mo</strong>
            </KeyValue>
            <KeyValue label="Linear time to milestone">
              {formatMonths(d.velocity.linearMonthsToMilestone)}
            </KeyValue>
            {d.velocity.notes.map((note) => (
              <p key={note} className="meta">
                {note}
              </p>
            ))}
          </div>
        </Card>

        <Card label="Strategy level" title={`Level ${d.strategyLevel.level} — ${d.strategyLevel.name}`}>
          <p>{d.strategyLevel.goal}</p>
          <div className="stack stack--tight" style={{ marginTop: 'var(--space-4)' }}>
            <KeyValue label="DRIP rate">{formatPct(d.config.dripRate, 0)}</KeyValue>
            <KeyValue label="Monthly contribution">{formatMoney(d.config.monthlyContribution, 0)}</KeyValue>
            <KeyValue label="Reinvest share after bifurcation">
              {formatPct(d.config.bifurcationReinvestShare, 0)}
            </KeyValue>
          </div>
        </Card>
      </div>

      <h2 className="section" style={{ fontSize: '1.1rem' }}>
        Per-position cash-flow detail
      </h2>
      {s.positions.length === 0 ? (
        <EmptyState title="No income-producing positions held">
          The income engine is empty. Distribution analytics appear once an income sleeve position exists.
        </EmptyState>
      ) : (
        <div className="grid grid--2">
          {s.positions.map((position) => (
            <Card
              key={`${position.accountName}-${position.symbol}`}
              label={`${position.symbol} · ${position.accountName}`}
              title={
                <div>
                  <h2 className="symbol">{position.symbol}</h2>
                  <span className="symbol__name">{position.name}</span>
                </div>
              }
              action={
                <Badge
                  tone={position.selfBuy.selfFundingMonthly ? 'positive' : 'gold'}
                  glyph={position.selfBuy.selfFundingMonthly ? '✓' : '◐'}
                >
                  {position.selfBuy.selfFundingMonthly ? 'Self-funding monthly' : 'Building'}
                </Badge>
              }
            >
              <div className="grid grid--2" style={{ gap: 'var(--space-3)' }}>
                <div className="stack stack--tight">
                  <KeyValue label="Shares">{formatShares(position.shares)}</KeyValue>
                  <KeyValue label="Price">{formatMoney(position.price)}</KeyValue>
                  <KeyValue label="Market value">{formatMoney(position.marketValue)}</KeyValue>
                  <KeyValue label="Cost basis">{formatMoney(position.costBasisTotal)}</KeyValue>
                  <KeyValue label="Unrealized">
                    {formatSignedMoney(position.unrealizedPL)}{' '}
                    <span className="soft">{formatSignedPct(position.unrealizedPLPct)}</span>
                  </KeyValue>
                  <KeyValue label="Distribution / share" hint={DISTRIBUTION_BASIS_LABELS[s.basis].toLowerCase()}>
                    {formatMoney(position.weeklyPerShare, 4)} wk
                  </KeyValue>
                  <KeyValue label="Modeled income">
                    {formatMoney(position.weeklyIncome)} wk · {formatMoney(position.monthlyIncome)} mo
                  </KeyValue>
                  <KeyValue label="Distribution rate" hint="not a total return">
                    {formatPct(position.distributionRate, 1)}
                  </KeyValue>
                </div>

                <div className="stack stack--tight">
                  <KeyValue label="Shares bought per month" hint="by its own cash">
                    {formatNumber(position.selfBuy.sharesPerMonth, 3)}
                  </KeyValue>
                  <KeyValue label="Shares for 1 share / month">
                    {position.selfBuy.sharesRequiredForOnePerMonth == null
                      ? '—'
                      : formatShares(position.selfBuy.sharesRequiredForOnePerMonth)}
                  </KeyValue>
                  <KeyValue label="Shares for 1 share / week">
                    {position.selfBuy.sharesRequiredForOnePerWeek == null
                      ? '—'
                      : formatShares(position.selfBuy.sharesRequiredForOnePerWeek)}
                  </KeyValue>
                  <KeyValue label="Capital for 1 share / month">
                    {formatMoney(position.selfBuy.capitalRequiredForOnePerMonth, 0)}
                  </KeyValue>
                  <KeyValue label="Return of capital">{formatPct(position.returnOfCapitalPct, 0)}</KeyValue>
                  <KeyValue label="NAV change (26w)">{formatSignedPct(position.navChange26w)}</KeyValue>
                  <KeyValue label="Total return (52w)">{formatSignedPct(position.totalReturn52w)}</KeyValue>
                  <KeyValue label="Stability / trend">
                    {formatNumber(position.stats.stability, 2)} · {formatSignedPct(position.stats.trend, 1)}
                  </KeyValue>
                </div>
              </div>

              <ProgressBar
                label="Progress to one self-bought share per month"
                value={position.selfBuy.progressToOnePerMonth ?? 0}
                valueLabel={formatPct(position.selfBuy.progressToOnePerMonth ?? 0, 1)}
                tone={position.selfBuy.selfFundingMonthly ? 'positive' : 'gold'}
              />

              <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
                <span>Per-share distributions</span>
                <span className="soft">{position.stats.frequency}</span>
              </p>
              <DistributionSparkline data={seriesFor(position.symbol)} />

              <div className="kv">
                <span className="kv__key">Trailing cash per share</span>
                <span className="kv__value">
                  4w {formatMoney(position.stats.paid4w, 4)} · 13w {formatMoney(position.stats.paid13w, 4)} · 52w{' '}
                  {formatMoney(position.stats.paid52w, 4)}
                </span>
              </div>

              {position.flags.length ? (
                <ul className="bullets" style={{ marginTop: 'var(--space-3)' }}>
                  {position.flags.map((flag) => (
                    <li key={flag}>
                      <span aria-hidden="true">▲ </span>
                      {flag}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
                  No distribution-quality warnings on this position.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
