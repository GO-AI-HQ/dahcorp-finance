import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { StatCard } from '../components/StatCard.js';
import { Badge } from '../components/Badge.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { ErrorState, LoadingCards } from '../components/States.js';
import { formatMoney, formatPct } from '../core/format.js';
import { IncomeEngine } from './IncomeEngine.js';

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
  const incomeCash = p.accounts
    .filter((row) => row.account.broker === 'schwab' && row.account.allocationEligible)
    .reduce((sum, row) => sum + row.cash, 0);
  const ymag = p.positions.find((row) => row.symbol === 'YMAG');
  const canBuyWholeYmag = Boolean(ymag?.price && incomeCash >= ymag.price);
  const topCandidate = signals.data?.opportunities.find((row) => !row.held && row.scoreDeltaVsHeld != null && row.scoreDeltaVsHeld > 0) ?? null;

  const decision = canBuyWholeYmag
    ? 'REVIEW ADD — enough authorized cash for a YMAG share'
    : 'WAIT — keep building the Income Cash Queue';

  return (
    <>
      <PageHead
        eyebrow="Income"
        title="Income Engine"
        lede="The goal is recurring investment cash flow, not the highest advertised yield. DAHCorp weighs actual distributions, capital preservation, total return and available Schwab cash before proposing an add."
        action={<Badge tone="ice">Capital Production</Badge>}
      />

      <div className="grid grid--4 section">
        <StatCard label="Monthly income goal" value={formatMoney(active.targetMonthlyIncome, 0) + '/mo'} tone="gold" caption="The active milestone the Income Engine is working toward." />
        <StatCard label="Projected monthly income" value={formatMoney(i.income.forwardMonthlyIncome) + '/mo'} badge={{ text: 'Modeled', tone: 'ice' }} caption={`Conservative planning estimate ${formatMoney(i.income.conservativeMonthlyIncome)}/mo.`} />
        <StatCard label="Income Cash Queue" value={formatMoney(incomeCash)} caption="Only explicitly authorized Schwab Income cash is available to this strategy." />
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
            <p className="meta">Current Schwab execution path uses whole shares.</p>
          </div>
          <div className="panel">
            <span className="soft">Research opportunity</span>
            <strong style={{ display: 'block', marginTop: 4 }}>{topCandidate?.symbol ?? 'No better candidate established'}</strong>
            <p className="meta">{topCandidate ? topCandidate.verdictReason : 'A new holding must improve the goal after total return, NAV behavior and risk are considered.'}</p>
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Link className="btn btn--sm btn--ghost" to="/growth?tab=opportunities">Compare opportunities</Link>
          <Link className="btn btn--sm btn--ghost" to="/strategy-lab">Strategy Lab</Link>
          <Link className="btn btn--sm btn--ghost" to="/portfolio">Open Income Cash Queue</Link>
        </div>
      </Card>

      <details className="section">
        <summary className="btn btn--ghost">View advanced Income Engine evidence</summary>
        <div style={{ marginTop: 16 }}><IncomeEngine /></div>
      </details>
    </>
  );
}
