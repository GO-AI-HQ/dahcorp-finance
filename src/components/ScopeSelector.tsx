import { useState } from 'react';
import { api } from '../services/api.js';
import { CALCULATION_SCOPES, type CalculationScope } from '../core/scope.js';
import { formatMoneyCompact } from '../core/format.js';

/**
 * The calculation scope switch.
 *
 * Scope is policy, not a view preference: every forward figure on the page —
 * income-engine capital, blended distribution rate, required capital, ETA,
 * contribution solver, simulator scenarios — is measured inside the selected
 * scope. So it is persisted through the settings endpoint like any other policy
 * change, and the page reloads its payload afterwards rather than filtering
 * client-side.
 */
export interface ScopeOption {
  scope: CalculationScope;
  label: string;
  description: string;
  investedValue: number;
  totalValue: number;
  incomeEngineCapital: number;
  positionCount: number;
  accountCount: number;
  containsSimulated: boolean;
}

export function ScopeSelector({
  scope,
  options,
  onChanged,
}: {
  scope: CalculationScope;
  options: ScopeOption[];
  /** Called after a successful save so the page can refetch its payload. */
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ordered = CALCULATION_SCOPES.map((s) => options.find((o) => o.scope === s)).filter(
    (o): o is ScopeOption => o !== undefined,
  );
  const active = ordered.find((o) => o.scope === scope) ?? ordered[0];

  async function change(next: CalculationScope) {
    if (next === scope) return;
    setSaving(true);
    setNote(null);
    try {
      const result = await api.saveSettings({ calculationScope: next });
      setNote(result.persisted ? null : (result.note ?? 'Scope applied for this session only.'));
      onChanged();
    } catch {
      setNote('Could not change the calculation scope.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="chip-group" role="group" aria-label="Calculation scope">
        {ordered.map((option) => (
          <button
            key={option.scope}
            type="button"
            className="chip"
            aria-pressed={option.scope === scope}
            disabled={saving}
            title={option.description}
            onClick={() => void change(option.scope)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="meta" style={{ marginTop: 10 }}>
        {active ? (
          <>
            {active.description} {formatMoneyCompact(active.totalValue)} across {active.positionCount} position
            {active.positionCount === 1 ? '' : 's'} in {active.accountCount} account
            {active.accountCount === 1 ? '' : 's'}.
          </>
        ) : null}
        {note ? ` ${note}` : ''}
      </p>
    </div>
  );
}
