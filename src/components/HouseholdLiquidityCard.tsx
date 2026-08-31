import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api.js';
import { liquidityApi } from '../services/liquidityApi.js';
import { useResource } from '../hooks/useResource.js';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { ProgressBar } from './ProgressBar.js';
import { formatMoney, formatPct } from '../core/format.js';

function rateLabel(value: number | null | undefined): string {
  return value == null ? 'Not available' : `${value.toFixed(2)}%`;
}

export function HouseholdLiquidityCard({ otherBrokerCash = 0 }: { otherBrokerCash?: number }) {
  const settings = useResource(() => api.settings(), []);
  const rates = useResource(() => liquidityApi.rates(), []);
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
  const savingsRate = rates.data?.savings ?? null;
  const treasuryRate = rates.data?.treasury ?? null;

  const modelQuestion = useMemo(() => {
    const evidence = [
      savingsRate?.medianApy != null
        ? `RateAPI currently shows a verified savings-market median APY of ${savingsRate.medianApy.toFixed(2)}% as of ${savingsRate.asOf ?? 'the latest available date'}.`
        : 'The current retail savings-market APY is not verified right now.',
      savingsRate?.bestPublishedApy != null
        ? `The highest published savings benchmark in the current RateAPI snapshot is ${savingsRate.bestPublishedApy.toFixed(2)}%, but do not assume I qualify for it until balance tiers, geography, membership and account rules are checked.`
        : '',
      treasuryRate?.annualizedPercent != null
        ? `The verified 3-month U.S. Treasury reference is ${treasuryRate.annualizedPercent.toFixed(2)}% as of ${treasuryRate.asOf ?? 'the latest available date'}; treat it as a comparison point, not as the same product as a savings account.`
        : 'The short-term Treasury reference is currently unavailable.',
    ].filter(Boolean).join(' ');

    return [
      `I currently have ${formatMoney(balance, 0)} in household savings outside my brokerages.`,
      `My current protected savings floor is ${formatMoney(target, 0)}.`,
      excess > 0
        ? `That leaves ${formatMoney(excess, 0)} above the current floor.`
        : `I am ${formatMoney(gap, 0)} below the current floor.`,
      `There is also ${formatMoney(otherBrokerCash, 0)} of broker cash that I can see but that is not currently assigned to an investment strategy.`,
      evidence,
      'Review my cash flow, known bills and obligations, investment plan and the latest verified market information.',
      'Recommend how much should stay immediately available as household savings, how much (if any) is truly extra, and where the protected savings should sit so it can earn a competitive return without making the money hard to reach.',
      'Compare appropriate insured high-yield savings choices, money-market choices and short-duration Treasury options only when the data actually supports the comparison.',
      'If extra cash could reasonably be invested through Schwab or Robinhood, give a maximum dollar amount only after preserving the recommended household reserve.',
      'Do not invent a rate or assume the highest advertised APY is available to me. Explain the answer in normal human language.',
    ].join(' ');
  }, [balance, target, excess, gap, otherBrokerCash, savingsRate, treasuryRate]);

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
      <Card label="Household savings" title="Savings reserve unavailable">
        <p className="meta">I could not load the saved reserve amount right now. Your brokerage cash is still kept separate.</p>
      </Card>
    );
  }

  if (!settings.data) {
    return (
      <Card label="Household savings" title="Loading your savings reserve…">
        <p className="meta">This money stays outside the investment accounts unless you explicitly decide otherwise.</p>
      </Card>
    );
  }

  return (
    <Card
      label="Household savings"
      title={balance > 0 ? `${formatMoney(balance, 0)} set aside outside the brokerages` : 'Add the cash you keep outside the brokerages'}
      action={<Badge tone={gap > 0 ? 'warning' : 'positive'} glyph={gap > 0 ? '▲' : '✓'}>{gap > 0 ? `${formatMoney(gap, 0)} below your floor` : 'Savings floor covered'}</Badge>}
      hint="This is the cash you want available for real life. The app can compare safer places to hold it, but it does not treat this money as available for investing by default."
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
          <p className="field__hint">Update this whenever the amount in your savings account changes.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="householdReserveFloor">Keep at least this much available</label>
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
          <p className="field__hint">This stays protected until you choose to change it.</p>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <ProgressBar
          label="How much of your savings floor is covered"
          value={coverage}
          valueLabel={target > 0 ? `${formatPct(coverage, 0)} covered` : 'No floor set'}
          tone={gap > 0 ? 'risk' : 'positive'}
          caption={target > 0 ? `${formatMoney(protectedAmount, 0)} protected · ${excess > 0 ? `${formatMoney(excess, 0)} above the floor` : `${formatMoney(gap, 0)} still needed`}` : 'Set a floor if you want the app to protect a minimum savings amount.'}
        />
      </div>

      <div className="grid grid--3" style={{ marginTop: 14 }}>
        <div className="panel"><span className="soft">Protected savings</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(protectedAmount, 0)}</strong><p className="meta">Kept out of investment decisions unless you deliberately change the floor.</p></div>
        <div className="panel"><span className="soft">Above the floor</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(excess, 0)}</strong><p className="meta">Potentially flexible, but only after your bills, cushion and near-term needs are covered.</p></div>
        <div className="panel"><span className="soft">Other broker cash</span><strong style={{ display: 'block', marginTop: 4 }}>{formatMoney(otherBrokerCash, 0)}</strong><p className="meta">Shown separately. It is not counted as your outside savings.</p></div>
      </div>

      <div className="grid grid--3" style={{ marginTop: 14 }}>
        <div className="panel">
          <span className="soft">Typical savings rate in the live sample</span>
          <strong style={{ display: 'block', marginTop: 4 }}>{rateLabel(savingsRate?.medianApy)}</strong>
          <p className="meta">RateAPI median{savingsRate?.asOf ? ` · ${savingsRate.asOf}` : ''}. This is a market comparison, not your current bank rate.</p>
        </div>
        <div className="panel">
          <span className="soft">Highest published savings rate</span>
          <strong style={{ display: 'block', marginTop: 4 }}>{rateLabel(savingsRate?.bestPublishedApy)}</strong>
          <p className="meta">{savingsRate?.bestPublishedInstitution ? `${savingsRate.bestPublishedInstitution}. ` : ''}Eligibility and balance rules must be checked before treating this as available to you.</p>
        </div>
        <div className="panel">
          <span className="soft">3-month Treasury reference</span>
          <strong style={{ display: 'block', marginTop: 4 }}>{rateLabel(treasuryRate?.annualizedPercent)}</strong>
          <p className="meta">FRED reference{treasuryRate?.asOf ? ` · ${treasuryRate.asOf}` : ''}. Useful for comparison, but not the same as an insured savings account.</p>
        </div>
      </div>

      {rates.error ? <p className="meta" style={{ marginTop: 10 }}>Live savings-rate comparisons are unavailable right now. Your saved balance and protected floor still work normally.</p> : null}
      {message ? <p className="meta" style={{ marginTop: 10 }}>{message}</p> : null}

      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Link className="btn btn--sm btn--gold" to={`/modeling-lab?question=${encodeURIComponent(modelQuestion)}`}>Help me make the most of this cash</Link>
        <Link className="btn btn--sm btn--ghost" to="/settings">Savings settings</Link>
      </div>
      <p className="meta" style={{ marginTop: 10 }}>The strategist can suggest a different savings floor or a better place to keep the money, but it cannot quietly lower your protected amount or move the cash.</p>
    </Card>
  );
}
