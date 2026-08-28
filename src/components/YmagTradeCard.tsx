import { useMemo, useState } from 'react';
import { api, ApiError, type SchwabExecutionResponse, type SchwabTradePreviewResponse } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { formatMoney } from '../core/format.js';

export function YmagTradeCard() {
  const schwab = useResource(() => api.schwabStatus(), []);
  const [accountId, setAccountId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [preview, setPreview] = useState<SchwabTradePreviewResponse | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [execution, setExecution] = useState<SchwabExecutionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const status = schwab.data;
  const selectedId = accountId || status?.accounts[0]?.id || '';
  const selectedAccount = useMemo(
    () => status?.accounts.find((account) => account.id === selectedId) ?? status?.accounts[0] ?? null,
    [status, selectedId],
  );

  async function createPreview() {
    if (!selectedAccount) return;
    setBusy(true);
    setMessage(null);
    setExecution(null);
    setConfirmation('');
    try {
      const result = await api.schwabTradePreview(selectedAccount.id, quantity);
      setPreview(result);
      if (!result.approved) setMessage('The deterministic live-execution gate blocked this order.');
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof ApiError ? error.message : 'The live preview could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!preview?.previewId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.executeOrder(preview.previewId, confirmation);
      setExecution(result);
      setPreview(null);
      setConfirmation('');
      setMessage(result.order.message);
      schwab.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'The order request could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (schwab.loading) {
    return (
      <Card label="Schwab execution" title="YMAG accumulation" tone="accent">
        <p className="soft">Checking the production Schwab connection…</p>
      </Card>
    );
  }

  if (schwab.error) {
    return (
      <Card label="Schwab execution" title="YMAG accumulation" tone="risk">
        <div className="banner banner--risk">
          <span className="banner__glyph">!</span>
          <div><strong className="banner__title">Schwab status unavailable</strong>{schwab.error.message}</div>
        </div>
        <button className="btn btn--sm" type="button" onClick={schwab.reload} style={{ marginTop: 12 }}>Retry</button>
      </Card>
    );
  }

  if (!status?.connected) {
    return (
      <Card
        label="Schwab execution"
        title="Connect Charles Schwab"
        tone="accent"
        hint="Authorization happens on Schwab's site. DAHCorp Finance never receives your Schwab username or password."
      >
        <p className="soft" style={{ marginBottom: 14 }}>{status?.note ?? 'Schwab authorization is required.'}</p>
        <a className="btn btn--gold" href={status?.connectUrl ?? '/.netlify/functions/schwab-auth-start'}>
          Authorize Schwab
        </a>
      </Card>
    );
  }

  return (
    <Card
      label="Schwab execution"
      title="Buy YMAG"
      tone="accent"
      action={
        <Badge tone={status.executionEnabled ? 'positive' : 'warning'} glyph={status.executionEnabled ? '✓' : '—'}>
          {status.executionEnabled ? 'Human-approved live' : 'Read only'}
        </Badge>
      }
      hint="Funding is intentionally separate: the Individual Trader API does not expose a supported retail money-transfer endpoint. Move cash through Schwab/MoneyLink; this surface uses Schwab-reported cash available for trading after it arrives."
    >
      <div className="grid grid--2" style={{ marginBottom: 16 }}>
        <div>
          <p className="meta">Live YMAG mark</p>
          <p className="figure figure--sm figure--gold">{status.quote ? formatMoney(status.quote.price) : '—'}</p>
          {status.quote?.bid != null && status.quote?.ask != null ? (
            <p className="meta">Bid {formatMoney(status.quote.bid)} · Ask {formatMoney(status.quote.ask)}</p>
          ) : null}
        </div>
        <div>
          <p className="meta">Schwab cash available</p>
          <p className="figure figure--sm">{selectedAccount ? formatMoney(selectedAccount.cash) : '—'}</p>
          <p className="meta">Fresh broker cash is rechecked again at execution.</p>
        </div>
      </div>

      {status.accounts.length > 1 ? (
        <label className="field" style={{ marginBottom: 12 }}>
          <span className="field__label">Schwab account</span>
          <select value={selectedId} onChange={(event) => { setAccountId(event.target.value); setPreview(null); }}>
            {status.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
      ) : null}

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
          <span className="field__hint">Execution is hard-allowlisted to BUY YMAG market orders.</span>
        </label>
        <button
          className="btn btn--gold btn--block"
          type="button"
          disabled={!status.executionEnabled || !selectedAccount || busy}
          onClick={createPreview}
        >
          {busy ? 'Checking…' : 'Preview YMAG buy'}
        </button>
      </div>

      {!status.executionEnabled ? (
        <div className="banner">
          <span className="banner__glyph">—</span>
          <div><strong className="banner__title">Execution deployment flag is off</strong>{status.note}</div>
        </div>
      ) : null}

      {preview ? (
        <div className={`banner ${preview.approved ? 'banner--intel' : 'banner--risk'}`} style={{ marginTop: 14 }}>
          <span className="banner__glyph">{preview.approved ? '✓' : '!'}</span>
          <div style={{ width: '100%' }}>
            <strong className="banner__title">
              {preview.quantity} YMAG · estimated {formatMoney(preview.estimatedTotal)}
            </strong>
            <p className="meta" style={{ marginTop: 4 }}>
              Live price {formatMoney(preview.quote.price)} · preview expires in 5 minutes. Market orders can fill at a different price.
            </p>
            {preview.findings.filter((finding) => finding.severity === 'block').map((finding) => (
              <p key={finding.code} className="meta" style={{ marginTop: 4 }}>{finding.message}</p>
            ))}
            {preview.approved && preview.previewId ? (
              <div style={{ marginTop: 12 }}>
                <label className="field">
                  <span className="field__label">Type BUY YMAG to place this order</span>
                  <input
                    type="text"
                    autoComplete="off"
                    value={confirmation}
                    disabled={busy}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
                <button
                  className="btn btn--danger"
                  type="button"
                  style={{ marginTop: 10 }}
                  disabled={busy || confirmation.trim().toUpperCase() !== preview.confirmationText}
                  onClick={execute}
                >
                  {busy ? 'Submitting…' : 'Confirm & place YMAG order'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {execution ? (
        <div className="banner" style={{ marginTop: 14 }}>
          <span className="banner__glyph">✓</span>
          <div>
            <strong className="banner__title">Order submitted to Schwab</strong>
            {execution.note}
          </div>
        </div>
      ) : null}

      {message ? <p className="meta" style={{ marginTop: 10 }}>{message}</p> : null}
    </Card>
  );
}
