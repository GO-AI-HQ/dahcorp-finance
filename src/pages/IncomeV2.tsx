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

export function IncomeV2() {
  const income = useResource(() => api.income(), []);
  const portfolio = useResource(() => api.portfolio(), []);
  const signals = useResource(() => api.signals(), []);

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

  const decision = challenger
    ? `MODEL ROTATION — ${challenger.symbol} clears the +${CHALLENGER_HURDLE}-point challenger hurdle`
    : canBuyWholeYmag
      ? 'REVIEW ADD — enough 3085 cash for a YMAG share'
      : 'WAIT — keep building the 3085 Income Cash Queue';
  const modelQuestion = challenger
    ? `Compare my current Income Engine with rotating an appropriate amount into ${challenger.symbol}. The active objective is ${formatMoney(active.targetMonthlyIncome, 0)}/month. Only recommend the rotation if it improves that objective after NAV behavior, total return, return of capital, liquidity, overlap and risk.`
    : `Given the current Schwab 3085 Income Cash Queue and the ${formatMoney(active.targetMonthlyIncome, 0)}/month goal, should I buy additional YMAG, use a better qualified Income challenger, or hold cash? Recommend a specific dollar amount only if it improves the goal.`;

  return (
    <>
      <PageHead
        eyebrow="Income"
        title="Income Engine"
        lede="The goal is recurring investment cash flow, not the highest advertised yield. DAHCorp weighs actual distributions, capital preservation, total return and Schwab 3085 cash before proposing an add or rotation."
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
            <p className="meta">Schwab live execution remains whole-share BUY YMAG in account 3085.</p>
          </div>
          <div className="panel">
            <span className="soft">Best unheld challenger</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{bestResearchCandidate?.symbol ?? 'No candidate established'}</strong>
            <p className="meta">{bestResearchCandidate?.scoreDeltaVsHeld == null ? 'A new holding must materially improve the goal.' : `${bestResearchCandidate.scoreDeltaVsHeld >= 0 ? '+' : ''}${formatNumber(bestResearchCandidate.scoreDeltaVsHeld, 1)} efficiency points vs. the best held Income position.`}</p>
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent(modelQuestion)}`}>Build Income Proposed Model</Link>
          <Link className="btn btn--sm btn--ghost" to="/growth?tab=opportunities">Compare opportunities</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">Open 3085 action queue</Link>
        </div>
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
        <p className="meta" style={{ marginTop: 10 }}>The +{CHALLENGER_HURDLE}-point hurdle is a screening rule, not sufficient execution authority. Modeling and deterministic risk remain mandatory.</p>
      </Card>

      <details className="section">
        <summary className="btn btn--ghost">View advanced Income Engine evidence</summary>
        <div style={{ marginTop: 16 }}><IncomeEngine /></div>
      </details>
    </>
  );
}
