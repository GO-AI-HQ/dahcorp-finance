import { useEffect, useMemo, useState } from 'react';
import { api, type SimulationResponse } from '../services/api.js';
import { ApiError } from '../services/api.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { StatCard } from '../components/StatCard.js';
import { Badge } from '../components/Badge.js';
import { KeyValue } from '../components/KeyValue.js';
import { DataBanner } from '../components/DataBanner.js';
import { ScopeSelector } from '../components/ScopeSelector.js';
import { ErrorState, LoadingBlock } from '../components/States.js';
import { ProjectionChart, type ProjectionSeries } from '../charts/ProjectionChart.js';
import { CHART } from '../charts/theme.js';
import { formatMoney, formatMonths, formatPct } from '../core/format.js';

const SCENARIO_COLOR: Record<string, string> = {
  conservative: CHART.ice,
  base: CHART.gold,
  aggressive: CHART.positive,
};

interface Inputs {
  monthlyContribution: number;
  lumpSum: number;
  lumpSumMonth: number;
  dripRate: number;
  targetMonthlyIncome: number;
  horizonMonths: number;
}

export function Simulator() {
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped when the calculation scope changes, so the projection re-solves
  // against the newly selected capital base.
  const [scopeNonce, setScopeNonce] = useState(0);

  // Seed the sliders from the stored policy, so the simulator opens on the
  // investor's real plan rather than on invented defaults.
  useEffect(() => {
    let alive = true;
    api
      .simulate({})
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
        if (alive) setError(err instanceof ApiError ? err : new ApiError('Simulation failed.', 0, 'UNKNOWN'));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Debounced re-solve as the sliders move.
  useEffect(() => {
    if (!inputs) return;
    setBusy(true);
    const handle = window.setTimeout(() => {
      api
        .simulate(inputs)
        .then((next) => {
          setResult(next);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err : new ApiError('Simulation failed.', 0, 'UNKNOWN')))
        .finally(() => setBusy(false));
    }, 260);
    return () => window.clearTimeout(handle);
  }, [inputs, scopeNonce]);

  const series = useMemo<ProjectionSeries[]>(
    () =>
      (result?.scenarios ?? []).map((scenario) => ({
        name: scenario.label,
        color: SCENARIO_COLOR[scenario.name] ?? CHART.intel,
        points: scenario.projection.months.map((m) => ({ month: m.month, monthlyIncome: m.monthlyIncome })),
      })),
    [result],
  );

  if (error && !result) return <ErrorState error={error} />;
  if (!result || !inputs) return <LoadingBlock rows={5} label="Building projection" />;

  const patch = (next: Partial<Inputs>) => setInputs((current) => (current ? { ...current, ...next } : current));
  const baseScenario = result.scenarios.find((s) => s.name === 'base') ?? result.scenarios[0];

  return (
    <>
      <PageHead
        eyebrow="Simulator"
        title="Goal simulator"
        lede="Scenario modelling under stated assumptions. These are projections, not forecasts, and the aggressive case is a ceiling — never a guarantee."
        action={busy ? <Badge tone="ice" glyph="◌">Recalculating</Badge> : undefined}
      />

      <DataBanner containsMockData={result.containsMockData} sourceNotes={result.sourceNotes} asOf={result.asOf} />

      <Card label="Calculation scope" title="Capital base for every scenario" tight>
        <ScopeSelector scope={result.scope} options={result.scopeOptions} onChanged={() => setScopeNonce((n) => n + 1)} />
      </Card>

      <div className="grid grid--wide-left section">
        <Card label="Projection" title="Modeled forward monthly income">
          <ProjectionChart series={series} target={result.target} />
          <div className="tag-list" style={{ marginTop: 'var(--space-3)' }}>
            {result.scenarios.map((scenario) => (
              <Badge key={scenario.name} tone={scenario.name === 'aggressive' ? 'warning' : 'neutral'} glyph="●">
                {scenario.label}: rate {formatPct(scenario.annualDistributionRate, 1)}, NAV drift{' '}
                {formatPct(scenario.annualNavDrift, 1)}/yr
              </Badge>
            ))}
          </div>
        </Card>

        <Card label="Inputs" title="Assumptions">
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="contribution">
                Monthly contribution — {formatMoney(inputs.monthlyContribution, 0)}
              </label>
              <input
                id="contribution"
                type="range"
                min={0}
                max={3000}
                step={25}
                value={inputs.monthlyContribution}
                onChange={(e) => patch({ monthlyContribution: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="target">
                Target monthly income — {formatMoney(inputs.targetMonthlyIncome, 0)}
              </label>
              <input
                id="target"
                type="range"
                min={50}
                max={5000}
                step={50}
                value={inputs.targetMonthlyIncome}
                onChange={(e) => patch({ targetMonthlyIncome: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="drip">
                DRIP rate — {formatPct(inputs.dripRate, 0)}
              </label>
              <input
                id="drip"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={inputs.dripRate}
                onChange={(e) => patch({ dripRate: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="lump">
                One-time contribution — {formatMoney(inputs.lumpSum, 0)}
              </label>
              <input
                id="lump"
                type="range"
                min={0}
                max={50000}
                step={500}
                value={inputs.lumpSum}
                onChange={(e) => patch({ lumpSum: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="lumpMonth">
                Applied at month {inputs.lumpSumMonth}
              </label>
              <input
                id="lumpMonth"
                type="range"
                min={0}
                max={Math.max(1, inputs.horizonMonths)}
                step={1}
                value={Math.min(inputs.lumpSumMonth, inputs.horizonMonths)}
                onChange={(e) => patch({ lumpSumMonth: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="horizon">
                Horizon — {formatMonths(inputs.horizonMonths)}
              </label>
              <input
                id="horizon"
                type="range"
                min={6}
                max={120}
                step={6}
                value={inputs.horizonMonths}
                onChange={(e) => patch({ horizonMonths: Number(e.target.value) })}
              />
            </div>
            <p className="meta">
              Modeled rate {formatPct(result.modeledRate, 1)} · conservative {formatPct(result.conservativeRate, 1)}.
              Both are derived from the trailing distribution basis in Settings, never entered by hand.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid--3 section">
        {result.scenarios.map((scenario) => {
          const projection = scenario.projection;
          return (
            <StatCard
              key={scenario.name}
              label={scenario.label}
              value={projection.monthsToTarget == null ? 'Not reached' : formatMonths(projection.monthsToTarget)}
              tone={scenario.name === 'base' ? 'gold' : 'default'}
              badge={
                scenario.name === 'aggressive'
                  ? { text: 'Ceiling, not a forecast', tone: 'warning', glyph: '▲' }
                  : undefined
              }
              caption={
                <>
                  {scenario.description} Ending income {formatMoney(projection.finalMonthlyIncome)}/mo on{' '}
                  {formatMoney(projection.finalIncomeCapital, 0)} of income capital; {formatPct(projection.selfFundedShare, 0)}{' '}
                  of ending capital came from distributions rather than deposits.
                  {projection.targetDate ? ` Target date ${projection.targetDate}.` : ''}
                </>
              }
            />
          );
        })}
      </div>

      <div className="grid grid--2 section">
        <Card
          label="Contribution solver"
          title="What it takes to hit the target"
          hint="Solved from the current position and modeled rate on every run — these figures move as the portfolio and payouts move."
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Reach target in</th>
                  <th scope="col">Monthly contribution</th>
                  <th scope="col">Conservative rate</th>
                </tr>
              </thead>
              <tbody>
                {result.requiredContributions.map((row) => (
                  <tr key={row.months}>
                    <th scope="row">{formatMonths(row.months)}</th>
                    <td className="num">
                      {row.monthlyContribution.achieved && row.monthlyContribution.monthlyContribution != null
                        ? formatMoney(row.monthlyContribution.monthlyContribution, 0)
                        : 'Not reachable'}
                    </td>
                    <td className="num">
                      {row.conservativeMonthlyContribution.achieved &&
                      row.conservativeMonthlyContribution.monthlyContribution != null
                        ? formatMoney(row.conservativeMonthlyContribution.monthlyContribution, 0)
                        : 'Not reachable'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
            "Not reachable" means no contribution within the solver's bounds reaches {formatMoney(result.target, 0)}/mo in
            that time at the modeled rate.
          </p>
        </Card>

        <Card label="Base case detail" title={baseScenario?.label ?? 'Base'}>
          {baseScenario ? (
            <div className="stack stack--tight">
              <KeyValue label="Months to target">{formatMonths(baseScenario.projection.monthsToTarget)}</KeyValue>
              <KeyValue label="Required capital at target">
                {formatMoney(baseScenario.projection.requiredCapital, 0)}
              </KeyValue>
              <KeyValue label="Total contributed">{formatMoney(baseScenario.projection.totalContributed, 0)}</KeyValue>
              <KeyValue label="Total distributions">
                {formatMoney(baseScenario.projection.totalDistributions, 0)}
              </KeyValue>
              <KeyValue label="Total reinvested">{formatMoney(baseScenario.projection.totalReinvested, 0)}</KeyValue>
              <KeyValue label="Growth capital at horizon">
                {formatMoney(baseScenario.projection.finalGrowthCapital, 0)}
              </KeyValue>
              {baseScenario.projection.warnings.length ? (
                <ul className="bullets">
                  {baseScenario.projection.warnings.map((warning) => (
                    <li key={warning}>
                      <span aria-hidden="true">▲ </span>
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
