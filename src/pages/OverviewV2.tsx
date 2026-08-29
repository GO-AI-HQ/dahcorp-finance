import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { StatCard } from '../components/StatCard.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { DataBanner } from '../components/DataBanner.js';
import { ScopeSelector } from '../components/ScopeSelector.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { ValueAreaChart } from '../charts/ValueAreaChart.js';
import { formatMoney, formatMoneyCompact, formatMonths, formatPct, formatShares, formatSignedMoney } from '../core/format.js';

export function OverviewV2() {
  const [nonce, setNonce] = useState(0);
  const portfolio = useResource(() => api.portfolio(), [nonce]);
  const income = useResource(() => api.income(), [nonce]);
  const signals = useResource(() => api.signals(), [nonce]);

  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!portfolio.data) return <LoadingCards count={8} />;

  const p = portfolio.data;
  const s = p.incomeSummary;
  const milestone = p.milestones.find((m) => m.id === p.config.activeMilestoneId) ?? p.milestones[0];
  const robinhood = p.accounts.filter((a) => a.account.broker === 'robinhood');
  const schwab = p.accounts.filter((a) => a.account.broker === 'schwab');
  const brokerValue = (rows: typeof p.accounts) => rows.reduce((acc, row) => acc + row.totalValue, 0);
  const selfFunding = income.data?.income.selfFundingMilestone ?? null;
  const eta = p.velocity.linearMonthsToMilestone;
  const basisUnknown = p.positions.filter((position) => position.verified && position.marketValue > 0 && position.costBasisTotal === 0);
  const reserveEntered = p.config.externalLiquidityCurrent > 0;

  const growthCash = p.accounts
    .filter((row) => row.account.broker === 'robinhood' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const incomeCash = p.accounts
    .filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Income'))
    .reduce((sum, row) => sum + row.cash, 0);
  const maritimeCash = p.accounts
    .filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Maritime'))
    .reduce((sum, row) => sum + row.cash, 0);
  const otherBrokerCash = p.accounts
    .filter((row) => !row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);

  const maxTacticalDollars = p.totals.totalValue * p.leveraged.maxPct;
  const attention = (signals.data?.drag ?? []).filter((item) =>
    reserveEntered || !/reserve|liquidity/i.test(`${item.title} ${item.detail}`),
  );
  const topAttention = attention[0] ?? null;
  const modelingQuestion = topAttention
    ? `DAHCorp flagged this issue: ${topAttention.title}. ${topAttention.detail} What concrete portfolio action, if any, best resolves it? Compare doing nothing with the strongest eligible alternative and recommend a dollar amount only if the change materially improves the plan.`
    : 'Review my current Growth, Income and Maritime cash queues and portfolio. What is the single highest-value action to model now, if any? Holding cash is acceptable.';

  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="Your treasury today"
        lede="See where you stand, what is moving you toward your goals, and what needs a decision. Material issues now flow from Opportunities into Modeling Lab and then to the broker action queue."
        action={<Badge tone="intel" glyph="◆">Human-confirmed execution</Badge>}
      />

      <DataBanner containsMockData={p.containsMockData} sourceNotes={p.sourceNotes} asOf={p.asOf} />

      <Card label="What these numbers cover" title="Choose the part of the portfolio you want to measure" tight>
        <ScopeSelector scope={p.scope} options={p.scopeOptions} onChanged={() => setNonce((n) => n + 1)} />
      </Card>

      <div className="grid grid--4 section">
        <StatCard
          label="Portfolio value"
          value={formatMoney(p.totals.totalValue, 0)}
          tone="gold"
          delta={basisUnknown.length ? undefined : `${formatSignedMoney(p.totals.unrealizedPL, 0)} unrealized`}
          deltaDirection={basisUnknown.length ? 'flat' : p.totals.unrealizedPL > 0 ? 'up' : p.totals.unrealizedPL < 0 ? 'down' : 'flat'}
          caption={basisUnknown.length
            ? `${basisUnknown.length} transferred position${basisUnknown.length === 1 ? '' : 's'} missing broker cost basis; total gain/loss is hidden rather than guessed.`
            : `Cash ${formatMoney(p.totals.totalCash)} · invested ${formatMoney(p.totals.totalInvested, 0)}`}
        />
        <StatCard label="Robinhood" value={formatMoney(brokerValue(robinhood), 0)} caption={`${formatMoney(growthCash)} Growth Cash Queue · ${robinhood.reduce((a, row) => a + row.positionCount, 0)} positions`} />
        <StatCard label="Charles Schwab" value={formatMoney(brokerValue(schwab), 0)} caption={`${formatMoney(incomeCash)} Income 3085 · ${formatMoney(maritimeCash)} Maritime cash`} />
        <StatCard label="Income-producing capital" value={formatMoney(s.incomeEngineCapital, 0)} tone="ice" caption="Capital currently assigned to the recurring-income strategy." />

        <StatCard label="Income actually received (30d)" value={formatMoney(s.received30d)} badge={{ text: 'Received', tone: 'positive', glyph: '✓' }} caption={`Lifetime ${formatMoney(s.receivedLifetime)} · last 7 days ${formatMoney(s.received7d)}`} />
        <StatCard label="Projected monthly income" value={formatMoney(s.forwardMonthlyIncome)} badge={{ text: 'Modeled', tone: 'ice', glyph: 'i' }} caption={`Conservative planning estimate ${formatMoney(s.conservativeMonthlyIncome)}/mo. This is modeled until broker distribution history is imported.`} />
        <StatCard label={`${formatMoney(milestone.targetMonthlyIncome, 0)}/mo goal`} value={formatPct(Math.min(milestone.progress, 1), 1)} tone="gold" caption={milestone.requiredCapital != null ? `About ${formatMoneyCompact(milestone.capitalGap ?? 0)} more income-producing capital at the current modeled rate.` : 'Needs more distribution history before required capital can be modeled.'} />
        <StatCard label="Estimated time to goal" value={eta == null ? 'Not enough momentum yet' : formatMonths(eta)} badge={{ text: 'Projection', tone: 'warning', glyph: '▲' }} caption={eta == null ? 'DAHCorp will not invent an arrival date while observed income momentum is insufficient.' : 'Projection only; it changes with contributions, distributions and market conditions.'} />
      </div>

      <Card label="Decision pipeline" title="From a problem to an executable action">
        <div className="grid grid--3">
          <div className="panel"><strong>1 · Opportunities</strong><p className="meta">Identify the issue or setup that could materially improve Growth, Income or Maritime strategy.</p><Link className="btn btn--sm btn--ghost" to="/growth?tab=opportunities">Open Opportunities</Link></div>
          <div className="panel"><strong>2 · Modeling</strong><p className="meta">Compare the current plan with a concrete BUY, SELL, rotation or HOLD CASH proposal and see the Proposed Model.</p><Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent(modelingQuestion)}`}>Model highest-priority issue</Link></div>
          <div className="panel"><strong>3 · Action Queue</strong><p className="meta">Preview live-capable transaction legs and type the exact confirmation only after fresh broker checks pass.</p><Link className="btn btn--sm btn--ghost" to="/portfolio">Open Portfolio</Link></div>
        </div>
      </Card>

      <div className="grid grid--wide-left section">
        <Card label="Portfolio value" title="Value of what you own today" hint="Today’s share counts repriced against historical closes; this is not a transaction-accurate account equity curve.">
          {p.valueHistory.length > 1 ? <ValueAreaChart data={p.valueHistory} /> : <p className="meta">Not enough price history yet to draw the series.</p>}
        </Card>
        <Card label="Milestones" title="Your income ladder">
          <div className="stack stack--tight">
            {p.milestones.map((row) => (
              <ProgressBar key={row.id} label={`${formatMoney(row.targetMonthlyIncome, 0)}/mo`} value={row.progress} valueLabel={row.reached ? 'Reached' : formatPct(row.progress, 1)} tone={row.reached ? 'positive' : row.id === p.config.activeMilestoneId ? 'gold' : 'ice'} caption={row.requiredCapital != null ? `≈ ${formatMoneyCompact(row.requiredCapital)} income-producing capital at the modeled rate` : undefined} />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Self-funding milestone" title="When the income engine can buy another share itself">
          {selfFunding?.perSymbol.length ? (
            <div className="stack stack--tight">
              <ProgressBar label="Progress toward one self-bought share per month" value={selfFunding.combinedProgress} tone={selfFunding.allSelfFunding ? 'positive' : 'gold'} caption={`Current model requires about ${formatMoney(selfFunding.totalCapitalRequired, 0)} across ${selfFunding.perSymbol.length} income positions.`} />
              <div className="table-wrap">
                <table className="data"><thead><tr><th>Symbol</th><th>Shares now</th><th>Shares needed</th><th>Still needed</th></tr></thead><tbody>
                  {selfFunding.perSymbol.map((row) => <tr key={row.symbol}><th>{row.symbol}</th><td className="num">{formatShares(row.shares)}</td><td className="num">{row.sharesRequired == null ? '—' : formatShares(row.sharesRequired)}</td><td className="num">{row.sharesRemaining == null ? '—' : formatShares(row.sharesRemaining)}</td></tr>)}
                </tbody></table>
              </div>
            </div>
          ) : <p className="meta">Waiting for enough income/distribution data to calculate self-funding progress.</p>}
        </Card>

        <Card label="Income momentum" title="How your projected monthly income is changing">
          {!p.priorSnapshotAsOf ? (
            <><strong>Not enough observed history yet</strong><p className="meta">DAHCorp has a forward model, but it will not call a modeled difference “momentum” until there is a prior production observation to compare.</p></>
          ) : (
            <div className="stack stack--tight">
              <div className="key-value"><span>From new contributions</span><strong>{formatMoney(p.velocity.contributionDriven)}/mo</strong></div>
              <div className="key-value"><span>From reinvestment (DRIP)</span><strong>{formatMoney(p.velocity.dripDriven)}/mo</strong></div>
              <div className="key-value"><span>From market / distribution-rate change</span><strong>{formatSignedMoney(p.velocity.marketDriven)}/mo</strong></div>
              <div className="key-value"><span>Total change</span><strong>{formatSignedMoney(p.velocity.total)}/mo</strong></div>
            </div>
          )}
          <p className="meta"><Link to="/income">Open Income →</Link></p>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Investment guardrails" title="Your safeguards">
          <div className="stack stack--tight">
            <ProgressBar label="High-risk tactical investments" value={p.leveraged.maxPct > 0 ? p.leveraged.pct / p.leveraged.maxPct : 0} valueLabel={`${formatMoney(p.leveraged.value, 0)} of about ${formatMoney(maxTacticalDollars, 0)} allowed`} tone="risk" caption={`Your policy caps daily-reset leveraged products at ${formatPct(p.leveraged.maxPct, 0)} of portfolio value.`} />
            <div className="key-value"><span>Growth Cash Queue</span><strong>{formatMoney(growthCash)}</strong></div>
            <div className="key-value"><span>Income 3085 Cash Queue</span><strong>{formatMoney(incomeCash)}</strong></div>
            <div className="key-value"><span>Maritime Cash Queue</span><strong>{formatMoney(maritimeCash)}</strong></div>
            {otherBrokerCash > 0 ? <div className="key-value"><span>Other broker cash — visible, not agent-authorized</span><strong>{formatMoney(otherBrokerCash)}</strong></div> : null}
            <div className="key-value"><span>Outside emergency reserve</span><strong>{reserveEntered ? `${formatMoney(p.config.externalLiquidityCurrent, 0)} of ${formatMoney(p.config.externalLiquidityTarget, 0)}` : 'Status not entered'}</strong></div>
            <p className="meta">{p.concentrationBreaches.length ? `${p.concentrationBreaches.length} confirmed position limit finding(s) need review.` : 'No confirmed position limit is currently breached.'}</p>
          </div>
        </Card>

        <Card label="What needs your attention" title={attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'} to review` : 'Nothing urgent'} tone={attention.some((item) => item.severity === 'high') ? 'risk' : 'default'}>
          {signals.error ? <ErrorState error={signals.error} onRetry={signals.reload} /> : !signals.data ? (
            <p className="meta">Checking the portfolio…</p>
          ) : attention.length ? (
            <div className="stack stack--tight">
              {attention.slice(0, 5).map((item) => (
                <div key={item.title}>
                  <strong>{item.title}</strong>
                  <p className="meta">{item.detail}</p>
                  <Link className="btn btn--sm btn--ghost" to={`/modeling-lab?question=${encodeURIComponent(`DAHCorp flagged this issue: ${item.title}. ${item.detail} What should I actually do about it, if anything? Compare the current plan with a specific actionable alternative.`)}`}>Model response</Link>
                </div>
              ))}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Link className="btn btn--sm btn--ghost" to="/growth?tab=opportunities">See opportunities</Link><Link className="btn btn--sm btn--ghost" to="/portfolio">Open action queue</Link></div>
            </div>
          ) : (
            <><strong>No urgent portfolio action</strong><p className="meta">Cash can remain queued until an Income, Growth or Maritime opportunity actually qualifies.</p><p className="meta"><Link to="/intelligence">Check Market Intelligence →</Link></p></>
          )}
        </Card>
      </div>
    </>
  );
}
