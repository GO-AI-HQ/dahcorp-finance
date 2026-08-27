import { useEffect, useState } from 'react';
import { api, ApiError, type SettingsResponse } from '../services/api.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { KeyValue } from '../components/KeyValue.js';
import { ErrorState, LoadingBlock } from '../components/States.js';
import { DISTRIBUTION_BASIS_LABELS, type StrategyConfig } from '../core/config.js';
import { formatMoney, formatPct } from '../core/format.js';
import { SLEEVE_LABELS } from '../core/universe.js';

const DIP_REFERENCE_LABELS: Record<string, string> = {
  recent_high_60d: '60-day high',
  high_52w: '52-week high',
  sma50: '50-day moving average',
  sma200: '200-day moving average',
  fair_value: 'Fair-value estimate',
};

/** A number field that reads and writes a fraction as a percentage. */
function PercentField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onCommit: (fraction: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 10));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 10)), [value]);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min * 100}
        max={max * 100}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (Number.isFinite(parsed)) onCommit(parsed / 100);
        }}
      />
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

function MoneyField({
  id,
  label,
  hint,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={25}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (Number.isFinite(parsed)) onCommit(parsed);
        }}
      />
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

export function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((next) => alive && setData(next))
      .catch((err: unknown) => alive && setError(err instanceof ApiError ? err : new ApiError('Failed to load settings.', 0, 'UNKNOWN')));
    return () => {
      alive = false;
    };
  }, []);

  async function save(patch: Partial<StrategyConfig>) {
    if (!data || data.readOnly) return;
    setSaving(true);
    setMessage(null);
    setRejected([]);
    try {
      const result = await api.saveSettings(patch);
      setData({ ...data, config: result.config, persisted: result.persisted, note: result.note });
      setRejected(result.rejected);
      setMessage(
        result.persisted
          ? 'Saved. The risk engine will use these limits on the next evaluation.'
          : (result.note ?? 'Applied for this session only — no database is attached.'),
      );
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingBlock rows={6} label="Loading policy" />;

  const c = data.config;
  const locked = data.readOnly || saving;

  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="Deterministic policy"
        lede="These values are the policy. The risk engine reads this configuration and nothing else — Claude may argue for a change here, but only this form can make one."
        action={
          <div className="row" style={{ gap: 8 }}>
            <Badge tone={data.persisted ? 'positive' : 'warning'} glyph={data.persisted ? '✓' : '▲'}>
              {data.persisted ? 'Persisted' : 'Session only'}
            </Badge>
            {data.readOnly ? (
              <Badge tone="warning" glyph="▲">
                Read-only demo
              </Badge>
            ) : null}
          </div>
        }
      />

      {data.note ? (
        <div className="banner banner--mock" role="note">
          <span className="banner__glyph" aria-hidden="true">
            ▲
          </span>
          <div>
            <span className="banner__title">Configuration is not being persisted</span>
            <span>{data.note}</span>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="banner" role="status">
          <span className="banner__glyph" aria-hidden="true">
            ●
          </span>
          <div>
            <span>{message}</span>
            {rejected.length ? (
              <ul className="bullets">
                {rejected.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid grid--2 section">
        <Card label="Capital" title="Reserve & contributions">
          <MoneyField
            id="reserve"
            label={`Liquidity reserve — ${formatMoney(c.liquidityReserve, 0)}`}
            hint="Cash below this level is never offered for allocation, by Claude or by the deterministic planner."
            value={c.liquidityReserve}
            disabled={locked}
            onCommit={(value) => void save({ liquidityReserve: value })}
          />
          <MoneyField
            id="contribution"
            label={`Planned monthly contribution — ${formatMoney(c.monthlyContribution, 0)}`}
            value={c.monthlyContribution}
            disabled={locked}
            onCommit={(value) => void save({ monthlyContribution: value })}
          />
          <MoneyField
            id="maxOrder"
            label={`Maximum single order — ${formatMoney(c.maxOrderNotional, 0)}`}
            hint="Any proposed order above this is reduced or rejected by the risk engine."
            value={c.maxOrderNotional}
            disabled={locked}
            onCommit={(value) => void save({ maxOrderNotional: value })}
          />
          <PercentField
            id="drip"
            label={`DRIP rate — ${formatPct(c.dripRate, 0)}`}
            hint="Share of received distributions reinvested into the engine."
            value={c.dripRate}
            min={0}
            max={1}
            disabled={locked}
            onCommit={(value) => void save({ dripRate: value })}
          />
          <PercentField
            id="bifurcation"
            label={`Reinvest share after bifurcation — ${formatPct(c.bifurcationReinvestShare, 0)}`}
            hint="At the bifurcation milestone, the share of distributions kept compounding rather than redirected to growth."
            value={c.bifurcationReinvestShare}
            min={0}
            max={1}
            disabled={locked}
            onCommit={(value) => void save({ bifurcationReinvestShare: value })}
          />
        </Card>

        <Card label="Goal" title="Milestone & modeling">
          <div className="field">
            <label className="field__label" htmlFor="milestone">
              Active milestone
            </label>
            <select
              id="milestone"
              value={c.activeMilestoneId}
              disabled={locked}
              onChange={(e) => void save({ activeMilestoneId: e.target.value })}
            >
              {data.milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.label} — {formatMoney(milestone.monthlyIncome, 0)}/mo
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="targetDate">
              Target date (optional)
            </label>
            <input
              id="targetDate"
              type="date"
              value={c.targetDate}
              disabled={locked}
              onChange={(e) => void save({ targetDate: e.target.value })}
            />
            <p className="field__hint">Leave empty for no dated commitment.</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="basis">
              Distribution basis
            </label>
            <select
              id="basis"
              value={c.distributionBasis}
              disabled={locked}
              onChange={(e) => void save({ distributionBasis: e.target.value as StrategyConfig['distributionBasis'] })}
            >
              {Object.entries(DISTRIBUTION_BASIS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="field__hint">The trailing window every forward income figure is modeled from.</p>
          </div>
          <PercentField
            id="haircut"
            label={`Conservative haircut — ${formatPct(c.conservativeHaircut, 0)}`}
            hint="Applied to modeled distribution rates to produce the conservative case."
            value={c.conservativeHaircut}
            min={0}
            max={0.9}
            disabled={locked}
            onCommit={(value) => void save({ conservativeHaircut: value })}
          />
          <div className="field">
            <label className="field__label" htmlFor="allocation">
              Income allocation targets
            </label>
            <p className="field__hint" id="allocation-hint">
              Current: {Object.entries(c.incomeAllocationTargets).map(([symbol, weight]) => `${symbol} ${formatPct(weight, 0)}`).join(' · ')}.
              These weights are an opening position, not doctrine — the opportunity ranker continuously tests whether a
              different mix better serves the income objective.
            </p>
            <input
              id="allocation"
              type="text"
              defaultValue={Object.entries(c.incomeAllocationTargets)
                .map(([symbol, weight]) => `${symbol}:${Math.round(weight * 100)}`)
                .join(', ')}
              aria-describedby="allocation-hint"
              disabled={locked}
              onBlur={(e) => {
                const entries = e.target.value
                  .split(',')
                  .map((part) => part.split(':'))
                  .filter((parts) => parts.length === 2)
                  .map(([symbol, pct]) => [symbol.trim().toUpperCase(), Number(pct) / 100] as const)
                  .filter(([symbol, weight]) => symbol && Number.isFinite(weight));
                if (entries.length) void save({ incomeAllocationTargets: Object.fromEntries(entries) });
              }}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid--2 section">
        <Card label="Risk limits" title="Hard ceilings" tone="risk">
          <PercentField
            id="maxLeveraged"
            label={`Maximum leveraged sleeve — ${formatPct(c.maxLeveragedSleevePct, 1)}`}
            hint="Claude may not propose a purchase that pushes SOXL + TSMX above this without an explicit human override."
            value={c.maxLeveragedSleevePct}
            min={0}
            max={0.5}
            step={0.5}
            disabled={locked}
            onCommit={(value) => void save({ maxLeveragedSleevePct: value })}
          />
          <PercentField
            id="maxPosition"
            label={`Maximum single position — ${formatPct(c.maxSinglePositionPct, 0)}`}
            value={c.maxSinglePositionPct}
            min={0.05}
            max={1}
            disabled={locked}
            onCommit={(value) => void save({ maxSinglePositionPct: value })}
          />
          <PercentField
            id="maxExposure"
            label={`Maximum single underlying exposure — ${formatPct(c.maxSingleExposurePct, 0)}`}
            hint="Different tickers on the same underlying are counted together."
            value={c.maxSingleExposurePct}
            min={0.05}
            max={1}
            disabled={locked}
            onCommit={(value) => void save({ maxSingleExposurePct: value })}
          />
          <div className="field">
            <label className="switch" htmlFor="killSwitch">
              <input
                id="killSwitch"
                type="checkbox"
                checked={c.killSwitch}
                disabled={locked}
                onChange={(e) => void save({ killSwitch: e.target.checked })}
              />
              <span>
                Kill switch — block all order previews
                {c.killSwitch ? (
                  <>
                    {' '}
                    <Badge tone="negative" glyph="✕">
                      Active
                    </Badge>
                  </>
                ) : null}
              </span>
            </label>
          </div>
          <div className="stack stack--tight" style={{ marginTop: 'var(--space-4)' }}>
            <KeyValue label="Sleeve ceilings">
              {Object.entries(c.sleeveCeilings).length
                ? Object.entries(c.sleeveCeilings)
                    .map(([sleeve, ceiling]) => `${SLEEVE_LABELS[sleeve as keyof typeof SLEEVE_LABELS] ?? sleeve} ${formatPct(ceiling ?? 0, 0)}`)
                    .join(' · ')
                : 'None configured'}
            </KeyValue>
            <KeyValue label="Execution phase" hint="not settable over HTTP">
              Phase {c.executionPhase} — observer. Advancing this is a reviewed code change and a deploy, never a form
              submission.
            </KeyValue>
          </div>
        </Card>

        <Card label="Signals" title="Trend & dip thresholds">
          <div className="stack stack--tight">
            <KeyValue label="Moving averages">
              {c.trend.shortMaDays} / {c.trend.mediumMaDays} / {c.trend.longMaDays} day
            </KeyValue>
            <KeyValue label="RSI">
              period {c.trend.rsiPeriod} · weak below {c.trend.rsiWeakBelow} · extended above {c.trend.rsiExtendedAbove}
            </KeyValue>
            <KeyValue label="Drawdown warn / break">
              {formatPct(c.trend.drawdownWarnPct, 0)} / {formatPct(c.trend.drawdownBreakPct, 0)}
            </KeyValue>
            <KeyValue label="Benchmark">{c.trend.benchmarkSymbol}</KeyValue>
          </div>

          <div className="field" style={{ marginTop: 'var(--space-4)' }}>
            <label className="field__label" htmlFor="dipReference">
              Dip reference
            </label>
            <select
              id="dipReference"
              value={c.dipReference}
              disabled={locked}
              onChange={(e) => void save({ dipReference: e.target.value as StrategyConfig['dipReference'] })}
            >
              {Object.entries(DIP_REFERENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="dipLevels">
              Dip levels (percent, comma separated)
            </label>
            <input
              id="dipLevels"
              type="text"
              defaultValue={c.dipLevels.map((level) => Math.round(level * 100)).join(', ')}
              disabled={locked}
              onBlur={(e) => {
                const levels = e.target.value
                  .split(',')
                  .map((part) => Number(part.trim()) / 100)
                  .filter((value) => Number.isFinite(value) && value > 0 && value < 0.9);
                if (levels.length) void save({ dipLevels: levels });
              }}
            />
            <p className="field__hint">
              A price decline alone is never treated as evidence of undervaluation — the trend engine must still confirm.
            </p>
          </div>

          <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
            <span>Harvest rules</span>
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Tactical</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Harvest</th>
                  <th scope="col">Into</th>
                  <th scope="col">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {c.harvestRules.map((rule, index) => (
                  <tr key={rule.symbol}>
                    <th scope="row">{rule.symbol}</th>
                    <td className="num">+{formatPct(rule.triggerGainPct, 0)}</td>
                    <td className="num">{formatPct(rule.harvestPortionPct, 0)}</td>
                    <td>{rule.destinationSymbol}</td>
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          disabled={locked}
                          aria-label={`Enable the ${rule.symbol} harvest rule`}
                          onChange={(e) => {
                            const next = c.harvestRules.map((r, i) =>
                              i === index ? { ...r, enabled: e.target.checked } : r,
                            );
                            void save({ harvestRules: next });
                          }}
                        />
                        <span>{rule.enabled ? 'On' : 'Off'}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="section">
        <Card label="Strategy levels" title="How the plan changes as income grows">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Name</th>
                  <th scope="col">Income band</th>
                  <th scope="col">Goal</th>
                </tr>
              </thead>
              <tbody>
                {data.strategyLevels.map((level) => (
                  <tr key={level.level}>
                    <th scope="row">{level.level}</th>
                    <td>{level.name}</td>
                    <td className="num">
                      {formatMoney(level.incomeFloor, 0)}
                      {level.incomeCeiling == null ? '+' : ` – ${formatMoney(level.incomeCeiling, 0)}`}
                    </td>
                    <td>{level.goal}</td>
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
