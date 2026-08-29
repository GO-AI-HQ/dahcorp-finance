import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    let alive = true;
    api.simulate({})
      .then((initial) => {
        if (!alive) return;
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
      api.simulate(inputs)
        .then((next) => {
          setResult(next);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err : new ApiError('Strategy Lab could not recalculate.', 0, 'UNKNOWN')))
        .finally(() => setBusy(false));
    }, 260);
    return () => window.clearTimeout(handle);
  }, [inputs, scopeNonce]);

  const series = useMemo<ProjectionSeries[]>(
    () => (result?.scenarios ?? []).map((scenario) => ({
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

  return (
    <>
      <PageHead
        eyebrow="Strategy Lab"
        title="Test a decision before you make it"
        lede="Change contributions, reinvestment, timing and income goals to see how the plan responds. Nothing in Strategy Lab places a trade or changes the active strategy."
        action={busy ? <Badge tone="ice" glyph="◌">Recalculating</Badge> : <Badge tone="neutral">Simulation only</Badge>}
      />

      <DataBanner containsMockData={result.containsMockData} sourceNotes={result.sourceNotes} asOf={result.asOf} />

      <Card label="What the graph means" title="Three ways the same plan could develop" tight>
        <div className="grid grid--3">
          <div className="panel"><strong>Conservative outcome</strong><p className="meta">Uses the portfolio's conservative modeled rate. This is the cautious planning line.</p></div>
          <div className="panel"><strong>Current modeled path</strong><p className="meta">Uses today's configured assumptions and current holdings. This is the main planning line.</p></div>
          <div className="panel"><strong>Higher-rate illustration</strong><p className="meta">Shows the upper modeled case. It is not a forecast or promise.</p></div>
        </div>
      </Card>

      <Card label="Calculation scope" title="Which capital this plan is measuring" tight>
        <ScopeSelector scope={result.scope} options={result.scopeOptions} onChanged={() => setScopeNonce((n) => n + 1)} />
      </Card>

      <div className="grid grid--wide-left section">
        <Card label="Goal path" title="Projected monthly investment income">
          <ProjectionChart series={series} target={result.target} />
          <p className="meta" style={{ marginTop: 10 }}>
            Each line uses the same contribution and DRIP choices below; only the modeled return/distribution assumptions differ.
          </p>
        </Card>

        <Card label="Your choices" title="Change the plan">
          <div className="stack">
            <label className="field">
              <span className="field__label">Monthly contribution — {formatMoney(inputs.monthlyContribution, 0)}</span>
              <input type="range" min={0} max={3000} step={25} value={inputs.monthlyContribution} onChange={(e) => patch({ monthlyContribution: Number(e.target.value) })} />
              <span className="meta">How much new money you plan to add each month.</span>
            </label>
            <label className="field">
              <span className="field__label">Monthly income goal — {formatMoney(inputs.targetMonthlyIncome, 0)}</span>
              <input type="range" min={50} max={5000} step={50} value={inputs.targetMonthlyIncome} onChange={(e) => patch({ targetMonthlyIncome: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span className="field__label">Reinvest distributions — {formatPct(inputs.dripRate, 0)}</span>
              <input type="range" min={0} max={1} step={0.05} value={inputs.dripRate} onChange={(e) => patch({ dripRate: Number(e.target.value) })} />
              <span className="meta">100% means every modeled distribution goes back into the income engine.</span>
            </label>
            <label className="field">
              <span className="field__label">One-time contribution — {formatMoney(inputs.lumpSum, 0)}</span>
              <input type="range" min={0} max={50000} step={100} value={inputs.lumpSum} onChange={(e) => patch({ lumpSum: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span className="field__label">Apply one-time contribution in month {inputs.lumpSumMonth}</span>
              <input type="range" min={0} max={Math.max(1, inputs.horizonMonths)} step={1} value={Math.min(inputs.lumpSumMonth, inputs.horizonMonths)} onChange={(e) => patch({ lumpSumMonth: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span className="field__label">Look ahead — {formatMonths(inputs.horizonMonths)}</span>
              <input type="range" min={6} max={120} step={6} value={inputs.horizonMonths} onChange={(e) => patch({ horizonMonths: Number(e.target.value) })} />
            </label>
          </div>
        </Card>
      </div>

      <div className="grid grid--3 section">
        <StatCard
          label="Current modeled path"
          value={base.projection.monthsToTarget == null ? 'Goal not reached' : formatMonths(base.projection.monthsToTarget)}
          tone="gold"
          caption={`Ending modeled income ${formatMoney(base.projection.finalMonthlyIncome)}/mo with ${formatMoney(base.projection.finalIncomeCapital, 0)} in income-producing capital.`}
        />
        <StatCard
          label="Conservative outcome"
          value={conservative.projection.monthsToTarget == null ? 'Goal not reached' : formatMonths(conservative.projection.monthsToTarget)}
          caption={`Ending modeled income ${formatMoney(conservative.projection.finalMonthlyIncome)}/mo. Use this line when planning with more margin for error.`}
        />
        <StatCard
          label="Cash you add"
          value={formatMoney(inputs.monthlyContribution, 0) + '/mo'}
          caption={`Plus ${formatMoney(inputs.lumpSum, 0)} one-time in month ${inputs.lumpSumMonth}. DRIP ${formatPct(inputs.dripRate, 0)}.`}
        />
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
                    <td className="num">
                      {row.monthlyContribution.achieved && row.monthlyContribution.monthlyContribution != null
                        ? `${formatMoney(row.monthlyContribution.monthlyContribution, 0)}/mo`
                        : 'Not reachable'}
                    </td>
                    <td className="num">
                      {row.conservativeMonthlyContribution.achieved && row.conservativeMonthlyContribution.monthlyContribution != null
                        ? `${formatMoney(row.conservativeMonthlyContribution.monthlyContribution, 0)}/mo`
                        : 'Not reachable'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card label="Next evolution" title="From sliders to actual portfolio decisions">
          <p className="meta">
            PR #8 connects Growth and Market Intelligence to this lab. A qualified opportunity can be brought here to compare Hold Cash versus a staged purchase before anything reaches the Portfolio action queue.
          </p>
          <div className="banner" style={{ marginTop: 12 }}>
            <strong>Simulation never equals execution.</strong>
            <p className="meta">Adopting a future scenario will change the active plan only; required orders still go through Portfolio preview and deterministic safeguards.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
