import { useMemo, useState } from 'react';
import { ApiError } from '../services/api.js';
import { robinhoodApi, type RobinhoodExecutionResponse, type RobinhoodTradePreviewResponse } from '../services/robinhoodApi.js';
import { useResource } from '../hooks/useResource.js';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { formatMoney } from '../core/format.js';

export function NvdyTradeCard() {
  const robinhood = useResource(() => robinhoodApi.status(), []);
  const [accountId, setAccountId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [preview, setPreview] = useState<RobinhoodTradePreviewResponse | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [execution, setExecution] = useState<RobinhoodExecutionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const status = robinhood.data;
  const defaultAccount = status?.accounts.find((account) => account.tradeEligible) ?? status?.accounts[0] ?? null;
  const selectedId = accountId || defaultAccount?.id || '';
  const selectedAccount = useMemo(
    () => status?.accounts.find((account) => account.id === selectedId) ?? defaultAccount,
    [status, selectedId, defaultAccount],
  );

  async function createPreview() {
    if (!selectedAccount) return;
    setBusy(true);
    setMessage(null);
    setExecution(null);
    setConfirmation('');
    try {
      const result = await robinhoodApi.preview(selectedAccount.id, quantity);
      setPreview(result);
      if (!result.approved) setMessage('The deterministic Robinhood execution gate blocked this order.');
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof ApiError ? error.message : 'The Robinhood live preview could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!preview?.previewId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await robinhoodApi.execute(preview.previewId, confirmation);
      setExecution(result);
      setPreview(null);
      setConfirmation('');
      setMessage(result.order.message);
      robinhood.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'The Robinhood order request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (robinhood.loading) {
    return <Card label="Robinhood Agentic" title="NVDY accumulation" tone="accent"><p className="soft">Checking the official Robinhood Trading MCP…</p></Card>;
  }

  if (robinhood.error) {
    return (
      <Card label="Robinhood Agentic" title="NVDY accumulation" tone="risk">
        <div className="banner banner--risk"><span className="banner__glyph">!</span><div><strong className="banner__title">Robinhood status unavailable</strong>{robinhood.error.message}</div></div>
        <button className="btn btn--sm" type="button" onClick={robinhood.reload} style={{ marginTop: 12 }}>Retry</button>
      </Card>
    );
  }

  if (!status?.connected) {
    return (
      <Card
        label="Robinhood Agentic"
        title="Connect Robinhood"
        tone="accent"
        hint="DAHCorp Finance connects directly to Robinhood's official Trading MCP. Authentication and Agentic-account onboarding happen on Robinhood's site."
      >
        <p className="soft" style={{ marginBottom: 14 }}>{status?.note ?? 'Robinhood authorization is required.'}</p>
        <a className="btn btn--gold" href={status?.connectUrl ?? '/.netlify/functions/robinhood-auth-start'}>Authorize Robinhood</a>
      </Card>
    );
  }

  return (
    <Card
      label="Robinhood Agentic"
      title="Buy NVDY"
      tone="accent"
      action={
        <Badge tone={status.executionEnabled ? 'positive' : 'warning'} glyph={status.executionEnabled ? '✓' : '—'}>
          {status.executionEnabled ? 'Human-approved live' : 'Read only'}
        </Badge>
      }
      hint="Robinhood MCP can read connected brokerage accounts, but live orders are restricted by Robinhood to the separately funded Agentic account. DAHCorp additionally hard-allowlists BUY NVDY only."
    >
      <div className="grid grid--2" style={{ marginBottom: 16 }}>
        <div>
          <p className="meta">Live NVDY mark</p>
          <p className="figure figure--sm figure--gold">{status.quote ? formatMoney(status.quote.price) : '—'}</p>
          {status.quote?.bid != null && status.quote?.ask != null ? <p className="meta">Bid {formatMoney(status.quote.bid)} · Ask {formatMoney(status.quote.ask)}</p> : null}
        </div>
        <div>
          <p className="meta">Agentic buying power</p>
          <p className="figure figure--sm">{selectedAccount ? formatMoney(selectedAccount.cash) : '—'}</p>
          <p className="meta">Buying power and quote are rechecked immediately before execution.</p>
        </div>
      </div>

      <label className="field" style={{ marginBottom: 12 }}>
        <span className="field__label">Robinhood account</span>
        <select value={selectedId} onChange={(event) => { setAccountId(event.target.value); setPreview(null); }}>
          {status.accounts.map((account) => <option key={account.id} value={account.id} disabled={!account.tradeEligible}>{account.name}{account.tradeEligible ? ' · Agentic' : ' · read only'}</option>)}
        </select>
      </label>

      <div className="grid grid--2" style={{ alignItems: 'end', marginBottom: 14 }}>
        <label className="field">
          <span className="field__label">Whole shares</span>
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            disabled={!status.executionEnabled || busy}
            onChange={(event) => {
              const next = Number(event.target.value);
              setQuantity(Number.isFinite(next) ? Math.max(1, Math.floor(next)) : 1);
              setPreview(null);
              setExecution(null);
            }}
          />
          <span className="field__hint">First release is hard-allowlisted to BUY NVDY market orders in the Agentic account.</span>
        </label>
        <button className="btn btn--gold btn--block" type="button" disabled={!status.executionEnabled || !selectedAccount?.tradeEligible || busy} onClick={createPreview}>
          {busy ? 'Checking…' : 'Preview NVDY buy'}
        </button>
      </div>

      {!status.executionEnabled ? (
        <div className="banner"><span className="banner__glyph">—</span><div><strong className="banner__title">Robinhood execution flag is off</strong>{status.note}</div></div>
      ) : null}

      {preview ? (
        <div className={`banner ${preview.approved ? 'banner--intel' : 'banner--risk'}`} style={{ marginTop: 14 }}>
          <span className="banner__glyph">{preview.approved ? '✓' : '!'}</span>
          <div style={{ width: '100%' }}>
            <strong className="banner__title">{preview.quantity} NVDY · estimated {formatMoney(preview.estimatedTotal)}</strong>
            <p className="meta" style={{ marginTop: 4 }}>Live price {formatMoney(preview.quote.price)} · preview expires in 5 minutes. Market orders can fill at a different price.</p>
            {preview.brokerPreview?.warnings.map((warning) => <p key={warning} className="meta" style={{ marginTop: 4 }}>{warning}</p>)}
            {preview.findings.filter((finding) => finding.severity === 'block').map((finding) => <p key={finding.code} className="meta" style={{ marginTop: 4 }}>{finding.message}</p>)}
            {preview.approved && preview.previewId ? (
              <div style={{ marginTop: 12 }}>
                <label className="field"><span className="field__label">Type BUY NVDY to place this order</span><input type="text" autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
                <button className="btn btn--danger" type="button" style={{ marginTop: 10 }} disabled={busy || confirmation.trim().toUpperCase() !== preview.confirmationText} onClick={execute}>
                  {busy ? 'Submitting…' : 'Confirm & place NVDY order'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {execution ? <div className="banner" style={{ marginTop: 14 }}><span className="banner__glyph">✓</span><div><strong className="banner__title">Order submitted to Robinhood</strong>{execution.note}</div></div> : null}
      {message ? <p className="meta" style={{ marginTop: 10 }}>{message}</p> : null}
    </Card>
  );
}
