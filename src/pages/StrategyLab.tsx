import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type SimulationResponse } from '../services/api.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { StatCard } from '../components/StatCard.js';
import { Badge } from '../components/Badge.js';
import { DataBanner } from '../components/DataBanner.js';
import { ScopeSelector } from '../components/ScopeSelector.js';
import { ErrorState, LoadingBlock } from '../components/States.js';
import { ProjectionChart, type ProjectionSeries } from '../charts/ProjectionChart.js';
import { CHART } from '../charts/theme.js';
import { formatMoney, formatMonths, formatPct } from '../core/format.js';

interface Inputs {
  monthlyContribution: number;
  lumpSum: number;
  lumpSumMonth: number;
  dripRate: number;
  targetMonthlyIncome: number;
  horizonMonths: number;
}

const SCENARIO_COLOR: Record<string, string> = {
  conservative: CHART.ice,
  base: CHART.gold,
  aggressive: CHART.positive,
};

const SCENARIO_NAME: Record<string, string> = {
  conservative: 'Conservative outcome',
  base: 'Current modeled path',
  aggressive: 'Higher-rate illustration',
};

export function StrategyLab() {
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [scopeNonce, setScopeNonce] = useState(0);
  const planningBasisRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    api.simulate({})
      .then((initial) => {
        if (!alive) return;
        if (initial.modeledRate > 0) planningBasisRef.current = initial.modeledRate;
        setResult(initial);
        setInputs({
          monthlyContribution: Math.round(initial.inputs.monthlyContribution),
          lumpSum: Math.round(initial.inputs.lumpSum),
          lumpSumMonth: initial.inputs.lumpSumMonth,
          dripRate: initial.inputs.dripRate,
          targetMonthlyIncome: Math.round(initial.target),
          horizonMonths: initial.inputs.horizonMonths,
        });
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err : new ApiError('Strategy Lab could not build the current plan.', 0, 'UNKNOWN'));
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!inputs) return;
    setBusy(true);
    const handle = window.setTimeout(() => {
      api.simulate({ ...inputs, basisOverrideRate: planningBasisRef.current ?? undefined })
        .then((next) => {
          if (planningBasisRef.current == null && next.modeledRate > 0) planningBasisRef.current = next.modeledRate;
          setResult(next);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err : new ApiError('Strategy Lab could not recalculate.', 0, 'UNKNOWN')))
        .finally(() => setBusy(false));
    }, 260);
    return () => window.clearTimeout(handle);
  }, [inputs, scopeNonce]);

  const incomeEvidenceAvailable = Boolean(result && result.modeledRate > 0);
  const series = useMemo<ProjectionSeries[]>(
    () => !result || result.modeledRate <= 0 ? [] : result.scenarios.map((scenario) => ({
      name: SCENARIO_NAME[scenario.name] ?? scenario.label,
      color: SCENARIO_COLOR[scenario.name] ?? CHART.intel,
      points: scenario.projection.months.map((month) => ({ month: month.month, monthlyIncome: month.monthlyIncome })),
    })),
    [result],
  );

  if (error && !result) return <ErrorState error={error} />;
  if (!result || !inputs) return <LoadingBlock rows={5} label="Building Strategy Lab" />;

  const patch = (next: Partial<Inputs>) => setInputs((current) => current ? { ...current, ...next } : current);
  const base = result.scenarios.find((scenario) => scenario.name === 'base') ?? result.scenarios[0];
  const conservative = result.scenarios.find((scenario) => scenario.name === 'conservative') ?? result.scenarios[0];
  const unavailableLabel = 'Waiting for income data';

  return (
    <>
      <PageHead
        eyebrow="Strategy Lab"
        title="Change the assumptions — not the holdings"
        lede="Use Strategy Lab to test how much you add, how much income you reinvest, one-time deposits and how long a goal may take. The income-rate basis stays fixed while you move the sliders so you are comparing your choices against the same starting evidence. Reload the page to pick up a newer verified basis."
        action={busy ? <Badge tone="ice" glyph="◌">Recalculating</Badge> : <Badge tone="neutral">Planning only</Badge>}
      />

      <DataBanner containsMockData={result.containsMockData} sourceNotes={result.sourceNotes} asOf={result.asOf} />

      {!incomeEvidenceAvailable ? (
        <div className="banner banner--warning section">
          <div>
            <strong>Income projections are waiting for verified distribution history.</strong>
            <p className="meta">Your holdings and contribution settings are available, but Strategy Lab will not invent a yield for YMAG, NVDY or another income holding. Once verified distribution history reaches the income engine, the graph, goal timing and self-funding math will return automatically.</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid--2 section">
        <Card label="This lab answers" title="What happens if I change the plan?">
          <p className="meta">Contribution amount, reinvestment rate, one-time funding, target income and time horizon are planning choices. The lines below keep the same verified income basis while you compare those choices.</p>
        </Card>
        <Card label="Need a buy or sell decision?" title="Take it to Modeling Lab">
          <p className="meta">Modeling Lab reads the actual cash queues, holdings and market evidence, then compares specific securities with the option of doing nothing.</p>
          <p style={{ marginTop: 10 }}><Link className="btn btn--gold" to="/modeling-lab">Open Modeling Lab</Link></p>
        </Card>
      </div>

      <Card label="What the graph means" title="Three ways the same planning assumptions could develop" tight>
        <div className="grid grid--3">
          <div className="panel"><strong>Conservative outcome</strong><p className="meta">Uses a more cautious version of the verified income rate.</p></div>
          <div className="panel"><strong>Current modeled path</strong><p className="meta">Uses the verified income history that was available when this Strategy Lab session opened.</p></div>
          <div className="panel"><strong>Higher-rate illustration</strong><p className="meta">Shows the upper modeled case. It is not a forecast or promise.</p></div>
        </div>
      </Card>

      <Card label="What this plan includes" title="Which capital this plan is measuring" tight>
        <ScopeSelector scope={result.scope} options={result.scopeOptions} onChanged={() => { planningBasisRef.current = null; setScopeNonce((n) => n + 1); }} />
      </Card>

      <div className="grid grid--wide-left section">
        <Card label="Goal path" title="Projected monthly investment income">
          {incomeEvidenceAvailable ? (
            <ProjectionChart series={series} target={result.target} />
          ) : (
            <div className="panel" style={{ minHeight: 220, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
              <div><strong>Waiting for verified income history</strong><p className="meta">The chart will appear when the app can calculate a real distribution rate instead of assuming one.</p></div>
            </div>
          )}
          <p className="meta" style={{ marginTop: 10 }}>{incomeEvidenceAvailable ? 'Each line uses the same contribution and reinvestment choices below; only the modeled income-rate assumptions differ.' : 'Your contribution choices are still saved and editable while income data is unavailable.'}</p>
        </Card>

        <Card label="Your choices" title="Change the plan">
          <div className="stack">
            <label className="field"><span className="field__label">Monthly contribution — {formatMoney(inputs.monthlyContribution, 0)}</span><input type="range" min={0} max={3000} step={25} value={inputs.monthlyContribution} onChange={(e) => patch({ monthlyContribution: Number(e.target.value) })} /><span className="meta">How much new money you plan to add each month.</span></label>
            <label className="field"><span className="field__label">Monthly income goal — {formatMoney(inputs.targetMonthlyIncome, 0)}</span><input type="range" min={50} max={5000} step={50} value={inputs.targetMonthlyIncome} onChange={(e) => patch({ targetMonthlyIncome: Number(e.target.value) })} /></label>
            <label className="field"><span className="field__label">Reinvest distributions — {formatPct(inputs.dripRate, 0)}</span><input type="range" min={0} max={1} step={0.05} value={inputs.dripRate} onChange={(e) => patch({ dripRate: Number(e.target.value) })} /><span className="meta">100% means every modeled distribution goes back into the income holdings.</span></label>
            <label className="field"><span className="field__label">One-time contribution — {formatMoney(inputs.lumpSum, 0)}</span><input type="range" min={0} max={50000} step={100} value={inputs.lumpSum} onChange={(e) => patch({ lumpSum: Number(e.target.value) })} /></label>
            <label className="field"><span className="field__label">Apply one-time contribution in month {inputs.lumpSumMonth}</span><input type="range" min={0} max={Math.max(1, inputs.horizonMonths)} step={1} value={Math.min(inputs.lumpSumMonth, inputs.horizonMonths)} onChange={(e) => patch({ lumpSumMonth: Number(e.target.value) })} /></label>
            <label className="field"><span className="field__label">Look ahead — {formatMonths(inputs.horizonMonths)}</span><input type="range" min={6} max={120} step={6} value={inputs.horizonMonths} onChange={(e) => patch({ horizonMonths: Number(e.target.value) })} /></label>
          </div>
        </Card>
      </div>

      <div className="grid grid--3 section">
        <StatCard label="Current modeled path" value={!incomeEvidenceAvailable ? unavailableLabel : base.projection.monthsToTarget == null ? 'Goal not reached' : formatMonths(base.projection.monthsToTarget)} tone="gold" caption={!incomeEvidenceAvailable ? 'Verified distribution history is required before the app can turn your contributions into an income projection.' : `Ending modeled income ${formatMoney(base.projection.finalMonthlyIncome)}/mo with ${formatMoney(base.projection.finalIncomeCapital, 0)} in income-producing capital.`} />
        <StatCard label="Conservative outcome" value={!incomeEvidenceAvailable ? unavailableLabel : conservative.projection.monthsToTarget == null ? 'Goal not reached' : formatMonths(conservative.projection.monthsToTarget)} caption={!incomeEvidenceAvailable ? 'No conservative yield is guessed when the underlying income rate is unknown.' : `Ending modeled income ${formatMoney(conservative.projection.finalMonthlyIncome)}/mo. Use this line when planning with more margin for error.`} />
        <StatCard label="Cash you add" value={formatMoney(inputs.monthlyContribution, 0) + '/mo'} caption={`Plus ${formatMoney(inputs.lumpSum, 0)} one-time in month ${inputs.lumpSumMonth}. Reinvest ${formatPct(inputs.dripRate, 0)} of modeled distributions.`} />
      </div>

      <div className="grid grid--2 section">
        <Card label="Goal solver" title="What monthly contribution would hit the goal sooner?">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Target timing</th><th>Current model</th><th>Conservative model</th></tr></thead>
              <tbody>
                {result.requiredContributions.map((row) => (
                  <tr key={row.months}>
                    <th>{formatMonths(row.months)}</th>
                    <td className="num">{!incomeEvidenceAvailable ? 'Waiting for income data' : row.monthlyContribution.achieved && row.monthlyContribution.monthlyContribution != null ? `${formatMoney(row.monthlyContribution.monthlyContribution, 0)}/mo` : 'Not reachable'}</td>
                    <td className="num">{!incomeEvidenceAvailable ? 'Waiting for income data' : row.conservativeMonthlyContribution.achieved && row.conservativeMonthlyContribution.monthlyContribution != null ? `${formatMoney(row.conservativeMonthlyContribution.monthlyContribution, 0)}/mo` : 'Not reachable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card label="Next decision" title="When a planning choice becomes a buy or sell question">
          <p className="meta">If this plan changes how much you want to deploy, take the question to Modeling Lab. It reads the actual cash queues and holdings, compares specific securities with holding cash, and returns a proposed action that still has to pass the safety rules.</p>
          <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <Link className="btn btn--gold" to={`/modeling-lab?question=${encodeURIComponent(`Given a monthly contribution of ${formatMoney(inputs.monthlyContribution, 0)}, a ${formatMoney(inputs.targetMonthlyIncome, 0)}/month income goal and ${formatPct(inputs.dripRate, 0)} reinvestment, what actual portfolio action should I take next, if any?`)}`}>Take this plan to Modeling Lab</Link>
            <Link className="btn btn--ghost" to="/growth?tab=opportunities">See opportunities</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
