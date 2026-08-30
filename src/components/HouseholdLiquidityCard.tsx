import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { ProgressBar } from './ProgressBar.js';
import { formatMoney, formatPct } from '../core/format.js';

export function HouseholdLiquidityCard({ otherBrokerCash = 0 }: { otherBrokerCash?: number }) {
  const settings = useResource(() => api.settings(), []);
  const [balanceDraft, setBalanceDraft] = useState('');
  const [targetDraft, setTargetDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const config = settings.data?.config;
  useEffect(() => {
    if (!config) return;
    setBalanceDraft(String(config.externalLiquidityCurrent));
    setTargetDraft(String(config.externalLiquidityTarget));
  }, [config?.externalLiquidityCurrent, config?.externalLiquidityTarget]);

  const balance = config?.externalLiquidityCurrent ?? 0;
  const target = config?.externalLiquidityTarget ?? 0;
  const protectedAmount = Math.min(balance, target);
  const gap = Math.max(0, target - balance);
  const excess = Math.max(0, balance - target);
  const coverage = target > 0 ? Math.min(balance / target, 1) : 1;
  const locked = Boolean(settings.data?.readOnly || saving);

  const modelQuestion = useMemo(() => {
    return [
      `I currently have ${formatMoney(balance, 0)} in household savings outside my brokerages.`,
      `My current protected liquidity floor is ${formatMoney(target, 0)}.`,
      excess > 0
        ? `That leaves ${formatMoney(excess, 0)} above the current floor.`
        : `I am ${formatMoney(gap, 0)} below the current floor.`,
      `There is also ${formatMoney(otherBrokerCash, 0)} of broker cash that is visible for household awareness but is not currently assigned to a DAHCorp strategy.`,
      'Review my current cash flow, portfolio, known obligations, investment plan and the latest verified rate/macro evidence.',
      'Recommend how much money should stay immediately liquid as a household reserve, how much (if any) is genuinely excess, and where that reserve should sit so it can earn a competitive yield without sacrificing access when I need it.',
      'Compare sensible liquid choices such as an insured high-yield savings account, an appropriate money-market option or short-duration Treasury cash equivalent when verified data supports the comparison.',
      'If excess cash could reasonably be moved into Schwab or Robinhood for an investment opportunity, give a maximum dollar amount only after preserving the recommended household reserve.',
      'Do not invent an interest rate. If a rate is not verified, say that plainly. Explain the answer in normal human language.',
    ].join(' ');
  }, [balance, target, excess, gap, otherBrokerCash]);

  async function saveValue(key: 'externalLiquidityCurrent' | 'externalLiquidityTarget', raw: string) {
    if (!settings.data || locked) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      setMessage('Enter a valid dollar amount of zero or more.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveSettings({ [key]: value });
      setMessage(result.persisted ? 'Saved.' : (result.note ?? 'Updated for this session.'));
      settings.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Could not save the change.');
    } finally {
      setSaving(false);
    }
  }

  if (settings.error) {
    return (
      <Card label="Household liquidity" title="Savings reserve unavailable">
        <p className="meta">I could not load the saved reserve amount right now. Your brokerage cash is still kept separate.</p>
      </Card>
    );
  }

  if (!settings.data) {
    return (
      <Card label="Household liquidity" title="Loading your savings reserve…">
        <p className="meta">This money stays outside the trading accounts unless you explicitly decide otherwise.</p>
      </Card>
    );
  }

  return (
    <Card
      label="Household liquidity"
      title={balance > 0 ? `${formatMoney(balance, 0)} set aside outside the brokerages` : 'Add the cash you keep outside the brokerages'}
      action={<Badge tone={gap > 0 ? 'warning' : 'positive'} glyph={gap > 0 ? '▲' : '✓'}>{gap > 0 ? `${formatMoney(gap, 0)} below your floor` : 'Reserve covered'}</Badge>}
      hint="This is your household safety cash. DAHCorp can model it and compare better places to hold it, but it is not brokerage spending money by default."
    >
      <div className="grid grid--2">
        <div className="field">
          <label className="field__label" htmlFor="householdReserveBalance">Savings balance</label>
          <input
            id="householdReserveBalance"
            type="number"
            min={0}
            step={100}
            inputMode="decimal"
            value={balanceDraft}
            disabled={locked}
            onChange={(event) => setBalanceDraft(event.target.value)}
            onBlur={() => void saveValue('externalLiquidityCurrent', balanceDraft)}
          />
          <p className="field__hint">Update this whenever the amount in your savings/reserve account changes.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="householdReserveFloor">Keep at least this much liquid</label>
          <input
            id="householdReserveFloor"
            type="number"
            min={0}
            step={100}
            inputMode="decimal"
            value={targetDraft}
            disabled={locked}
            onChange={(event) => setTargetDraft(event.target.value)}
            onBlur={() => void saveValue('externalLiquidityTarget', targetDraft)}
          />
          <p className="field__hint">This remains the protected floor until you choose to change it.</p>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <ProgressBar
          label="How much of your reserve floor is covered"
          value={coverage}
          valueLabel={target > 0 ? `${formatPct(coverage, 0)} covered` : 'No floor set'}
          tone={gap > 0 ? 'risk' : 'positive'}
          caption={target > 0 ? `${formatMoney(protectedAmount, 0)} protected · ${excess > 0 ? `${formatMoney(excess, 0)} above the floor` : `${formatMoney(gap, 0)} still needed`}` : 'Set a floor if you want DAHCorp to protect a minimum household reserve.'}
        />
      </div>

      <div className="grid grid--3" style={{ marginTop: 14 }}>
        <div className="panel"><span className="soft">Protected</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(protectedAmount, 0)}</strong><p className="meta">DAHCorp treats this as household reserve, not investment cash.</p></div>
        <div className="panel"><span className="soft">Above the floor</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(excess, 0)}</strong><p className="meta">Potentially flexible, but only after the full household picture supports it.</p></div>
        <div className="panel"><span className="soft">Other broker cash</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(otherBrokerCash, 0)}</strong><p className="meta">Visible separately. It is not counted as your outside savings reserve.</p></div>
      </div>

      {message ? <p className="meta" style={{ marginTop: 10 }}>{message}</p> : null}

      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent(modelQuestion)}`}>Help me optimize this cash</Link>
        <Link className="btn btn--sm btn--ghost" to="/settings">More reserve settings</Link>
      </div>
      <p className="meta" style={{ marginTop: 10 }}>The strategist may recommend a different reserve target or a better place to hold the money, but it cannot silently lower your protected floor or move the cash.</p>
    </Card>
  );
}
