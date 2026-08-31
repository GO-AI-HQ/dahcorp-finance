import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { StatCard } from '../components/StatCard.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { formatMoney, formatNumber, formatPct } from '../core/format.js';
import { IncomeEngine } from './IncomeEngine.js';

const CHALLENGER_HURDLE = 10;

function shortDate(value: string | null): string {
  if (!value) return 'Not announced';
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : value;
}

function candidateCategory(value: string): string {
  if (value === 'option_income') return 'Option-income fund';
  if (value === 'dividend_compounder') return 'Dividend grower';
  if (value === 'cyclical_income') return 'Cyclical income';
  return 'High-yield equity';
}

export function IncomeV2() {
  const income = useResource(() => api.income(), []);
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);
  const [refreshingResearch, setRefreshingResearch] = useState(false);

  if (income.error) return <ErrorState error={income.error} onRetry={income.reload} />;
  if (portfolio.error) return <ErrorState error={portfolio.error} onRetry={portfolio.reload} />;
  if (!income.data || !portfolio.data) return <LoadingCards count={5} />;

  const i = income.data;
  const p = portfolio.data;
  const active = i.milestones.find((row) => row.id === i.config.activeMilestoneId) ?? i.milestones[0];
  const incomeAccounts = p.accounts.filter((row) => row.account.broker === 'schwab' && row.account.role.includes('Income'));
  const incomeCash = incomeAccounts.reduce((sum, row) => sum + row.cash, 0);
  const ymag = p.positions.find((row) => row.symbol === 'YMAG' && incomeAccounts.some((account) => account.account.id === row.accountId))
    ?? p.positions.find((row) => row.symbol === 'YMAG');
  const canBuyWholeYmag = Boolean(ymag?.price && incomeCash >= ymag.price);

  const rankedCandidates = (signals.data?.opportunities ?? [])
    .filter((row) => !row.held && row.scoreDeltaVsHeld != null)
    .sort((a, b) => (b.scoreDeltaVsHeld ?? -Infinity) - (a.scoreDeltaVsHeld ?? -Infinity));
  const challenger = rankedCandidates.find((row) => (row.scoreDeltaVsHeld ?? 0) >= CHALLENGER_HURDLE) ?? null;
  const bestResearchCandidate = rankedCandidates[0] ?? null;
  const incomeResearch = i.incomeIntelligence.snapshot;
  const mutationIdeas = i.incomeIntelligence.proposals;
  const upcoming = incomeResearch?.upcoming.slice(0, 8) ?? [];
  const discoveryCandidates = incomeResearch?.candidates.slice(0, 8) ?? [];

  const decision = challenger
    ? `MODEL ROTATION — ${challenger.symbol} clears the +${CHALLENGER_HURDLE}-point challenger hurdle`
    : canBuyWholeYmag
      ? 'REVIEW ADD — enough 3085 cash for a YMAG share'
      : 'WAIT — keep building the 3085 Income Cash Queue';
  const modelQuestion = challenger
    ? `Compare my current Income Engine with rotating an appropriate amount into ${challenger.symbol}. The active objective is ${formatMoney(active.targetMonthlyIncome, 0)}/month. Only recommend the rotation if it improves that objective after NAV behavior, total return, return of capital, liquidity, overlap and risk.`
    : `Given the current Schwab 3085 Income Cash Queue and the ${formatMoney(active.targetMonthlyIncome, 0)}/month goal, should I buy additional YMAG, use a better qualified Income challenger, or hold cash? Recommend a specific dollar amount only if it improves the goal.`;

  const refreshResearch = async () => {
    setRefreshingResearch(true);
    try {
      await api.refreshIncomeIntelligence();
      income.reload();
    } finally {
      setRefreshingResearch(false);
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Income"
        title="Income Engine"
        lede="The goal is recurring investment cash flow, not the highest advertised yield. DAHCorp weighs actual distributions, capital preservation, total return and available cash before proposing an add or rotation."
        action={<Badge tone="ice">Capital Production</Badge>}
      />

      <div className="grid grid--4 section">
        <StatCard label="Monthly income goal" value={formatMoney(active.targetMonthlyIncome, 0) + '/mo'} tone="gold" caption="The active milestone the Income Engine is working toward." />
        <StatCard label="Projected monthly income" value={formatMoney(i.income.forwardMonthlyIncome) + '/mo'} badge={{ text: 'Modeled', tone: 'ice' }} caption={`Conservative planning estimate ${formatMoney(i.income.conservativeMonthlyIncome)}/mo.`} />
        <StatCard label="3085 Income Cash Queue" value={formatMoney(incomeCash)} caption="Only the Schwab Income mandate contributes to this figure. Maritime Schwab cash is excluded." />
        <StatCard label="Income-producing capital" value={formatMoney(i.income.incomeEngineCapital, 0)} caption="Current capital assigned to recurring-income holdings." />
      </div>

      <Card label="Current decision" title={decision}>
        <div className="grid grid--3">
          <div className="panel">
            <span className="soft">Progress to goal</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{formatPct(active.progress, 1)}</strong>
            <ProgressBar label="" value={active.progress} tone="gold" />
          </div>
          <div className="panel">
            <span className="soft">Current YMAG price</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{ymag ? formatMoney(ymag.price) : 'Unavailable'}</strong>
            <p className="meta">Current execution support remains limited by the broker rules shown before any trade preview.</p>
          </div>
          <div className="panel">
            <span className="soft">Best unheld challenger</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{bestResearchCandidate?.symbol ?? 'No candidate established'}</strong>
            <p className="meta">{bestResearchCandidate?.scoreDeltaVsHeld == null ? 'A new holding must materially improve the goal.' : `${bestResearchCandidate.scoreDeltaVsHeld >= 0 ? '+' : ''}${formatNumber(bestResearchCandidate.scoreDeltaVsHeld, 1)} efficiency points vs. the best held Income position.`}</p>
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent(modelQuestion)}`}>Model the next income move</Link>
          <Link className="btn btn--sm btn--ghost" to="/growth?tab=opportunities">Compare opportunities</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">Open 3085 action queue</Link>
        </div>
      </Card>

      <Card label="Upcoming income" title="What has been announced — and when the price may adjust">
        {upcoming.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Asset</th><th>Ex-date</th><th>Payment date</th><th>Cash / share</th><th>Next step</th></tr></thead>
              <tbody>
                {upcoming.map((row) => {
                  const timingQuestion = `For ${row.symbol}, compare buying before the ${row.exDate} ex-dividend date with waiting until the ex-date or shortly after. I am not trying to collect a free dividend. Use the expected price adjustment, current trend, spread/liquidity, distribution amount, total-return evidence and my actual portfolio to tell me whether either timing improves the plan.`;
                  return (
                    <tr key={`${row.symbol}-${row.exDate}-${row.paymentDate ?? ''}`}>
                      <th>{row.symbol}</th>
                      <td>{shortDate(row.exDate)}</td>
                      <td>{shortDate(row.paymentDate)}</td>
                      <td className="num">{row.amountPerShare == null ? 'Not announced' : formatMoney(row.amountPerShare, 4)}</td>
                      <td><Link className="btn btn--sm btn--ghost" to={`/modeling-lab?question=${encodeURIComponent(timingQuestion)}`}>Model before vs. after</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="meta">No upcoming distribution events are stored yet. This does not mean none exist; the daily FMP research pass may still be waiting for provider coverage.</p>}
        <p className="meta" style={{ marginTop: 10 }}>Buying just before an ex-dividend date does not create free return. The price normally adjusts for the distribution, so DAHCorp models both sides of the event instead of assuming the payout is an edge.</p>
      </Card>

      <Card label="Income ideas" title="The research universe can change even when the portfolio does not">
        {discoveryCandidates.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Asset</th><th>Type</th><th>12-mo cash yield</th><th>Recent annualized pace</th><th>Payout pattern</th><th>Observed growth</th><th /></tr></thead>
              <tbody>
                {discoveryCandidates.map((row) => {
                  const question = `Research ${row.symbol} as a possible income asset for my current portfolio. Compare it with the income holdings I already own. Use verified distribution history, total return, price/NAV retention, payout variability, overlap, taxes/return of capital when known, liquidity and current entry quality. If it is better, propose ADD, REPLACE or REWEIGHT; otherwise tell me to leave the portfolio alone.`;
                  return (
                    <tr key={row.symbol}>
                      <th><div>{row.symbol}</div><span className="meta">{row.name}</span></th>
                      <td>{candidateCategory(row.category)}</td>
                      <td className="num">{row.trailingYieldPct == null ? 'Unknown' : `${formatNumber(row.trailingYieldPct, 1)}%`}</td>
                      <td className="num">{row.thirteenWeekAnnualizedYieldPct == null ? 'Unknown' : `${formatNumber(row.thirteenWeekAnnualizedYieldPct, 1)}%`}</td>
                      <td>{row.payoutVariability === 'unknown' ? 'Not enough history' : `${row.payoutVariability} variability`}</td>
                      <td>{row.observedAnnualGrowthStreakYears ? `${row.observedAnnualGrowthStreakYears} yrs observed` : 'No streak established'}</td>
                      <td><Link className="btn btn--sm btn--ghost" to={`/modeling-lab?question=${encodeURIComponent(question)}`}>Model this idea</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="meta">The daily income-discovery snapshot has not produced a usable shortlist yet.</p>}
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--sm btn--ghost" disabled={refreshingResearch} onClick={() => { void refreshResearch(); }}>{refreshingResearch ? 'Refreshing research…' : 'Refresh income research'}</button>
          {incomeResearch?.asOf ? <span className="meta">Research updated {new Date(incomeResearch.asOf).toLocaleString()}.</span> : <span className="meta">The normal research pass runs once per day.</span>}
        </div>
      </Card>

      <Card label="Possible portfolio changes" title="The strategy can adapt without letting the app rewrite its own rules">
        {mutationIdeas.length ? (
          <div className="stack">
            {mutationIdeas.map((idea, index) => {
              const question = `${idea.headline}. ${idea.why} Pressure-test this as a ${idea.action} proposal against my actual holdings, cash, income goal and current market evidence. Do not recommend a change unless it improves the plan after total return and risk, not just headline yield.`;
              return (
                <div className="panel" key={`${idea.action}-${idea.symbol ?? 'hold'}-${index}`}>
                  <div className="row row--between" style={{ gap: 12, alignItems: 'flex-start' }}>
                    <div>
                      <Badge tone={idea.action === 'HOLD' ? 'neutral' : 'ice'}>{idea.action}</Badge>
                      <strong style={{ display: 'block', marginTop: 8 }}>{idea.headline}</strong>
                      <p className="meta">{idea.why}</p>
                      {idea.requiresPolicyApproval ? <p className="meta"><strong>Research only:</strong> this ticker is not automatically added to the approved trading universe.</p> : null}
                    </div>
                    <Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent(question)}`}>Pressure-test it</Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <p className="meta">No portfolio-change idea has enough stored research yet. That is a valid HOLD state.</p>}
      </Card>

      <Card label="Rotation rule" title={`A challenger should beat the best held Income position by at least ${CHALLENGER_HURDLE} efficiency points`}>
        {challenger ? (
          <div className="grid grid--3">
            <div className="panel"><span className="soft">Challenger</span><strong style={{ display: 'block' }}>{challenger.symbol}</strong><p className="meta">Efficiency score {formatNumber(challenger.efficiency.score, 1)}.</p></div>
            <div className="panel"><span className="soft">Advantage</span><strong style={{ display: 'block' }}>+{formatNumber(challenger.scoreDeltaVsHeld ?? 0, 1)} points</strong><p className="meta">Clears the +{CHALLENGER_HURDLE}-point research hurdle.</p></div>
            <div className="panel"><span className="soft">Next action</span><strong style={{ display: 'block' }}>MODEL — not automatic rotation</strong><p className="meta">The model still has to prove the move improves the {formatMoney(active.targetMonthlyIncome, 0)}/mo objective after economic quality and risk.</p></div>
          </div>
        ) : bestResearchCandidate ? (
          <div className="banner">
            <span className="banner__glyph">—</span>
            <div><strong className="banner__title">No +{CHALLENGER_HURDLE}-point challenger yet</strong>{bestResearchCandidate.symbol} is currently the strongest unheld research candidate at {bestResearchCandidate.scoreDeltaVsHeld == null ? 'an unavailable comparison' : `${bestResearchCandidate.scoreDeltaVsHeld >= 0 ? '+' : ''}${formatNumber(bestResearchCandidate.scoreDeltaVsHeld, 1)} points`}. Keep researching; do not rotate merely for a small score advantage.</div>
          </div>
        ) : <p className="meta">No unheld Income candidate has enough comparable data to challenge the current engine.</p>}
        <p className="meta" style={{ marginTop: 10 }}>The +{CHALLENGER_HURDLE}-point hurdle is a screening rule, not sufficient execution authority. Modeling and the safety rules remain mandatory.</p>
      </Card>

      <details className="section">
        <summary className="btn btn--ghost">View advanced Income Engine evidence</summary>
        <div style={{ marginTop: 16 }}><IncomeEngine /></div>
      </details>
    </>
  );
}
