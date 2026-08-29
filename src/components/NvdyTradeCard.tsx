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
  const [symbol, setSymbol] = useState('NVDY');
  const [quantity, setQuantity] = useState(1);
  const [preview, setPreview] = useState<RobinhoodTradePreviewResponse | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [execution, setExecution] = useState<RobinhoodExecutionResponse | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const status = robinhood.data;
  const defaultAccount = status?.accounts.find((account) => account.tradeEligible) ?? status?.accounts[0] ?? null;
  const selectedId = accountId || defaultAccount?.id || '';
  const selectedAccount = useMemo(
    () => status?.accounts.find((account) => account.id === selectedId) ?? defaultAccount,
    [status, selectedId, defaultAccount],
  );
  const activeSymbol = status?.allowlist.includes(symbol) ? symbol : status?.allowlist[0] ?? 'NVDY';
  const selectedQuote = status?.quotes?.[activeSymbol] ?? (activeSymbol === status?.symbol ? status?.quote : null);

  async function completeAuthorization() {
    if (!callbackUrl.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await robinhoodApi.completeAuth(callbackUrl.trim());
      setCallbackUrl('');
      robinhood.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'The Robinhood authorization could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function createPreview() {
    if (!selectedAccount) return;
    setBusy(true);
    setMessage(null);
    setExecution(null);
    setConfirmation('');
    try {
      const result = await robinhoodApi.preview(selectedAccount.id, quantity, activeSymbol);
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
    return <Card label="Robinhood Agentic" title="Growth strategy" tone="accent"><p className="soft">Checking the official Robinhood Trading MCP…</p></Card>;
  }

  if (robinhood.error) {
    return (
      <Card label="Robinhood Agentic" title="Growth strategy" tone="risk">
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
        <a
          className="btn btn--gold"
          href={status?.connectUrl ?? '/.netlify/functions/robinhood-auth-start'}
          target={status?.manualCompletionRequired ? '_blank' : undefined}
          rel={status?.manualCompletionRequired ? 'noreferrer' : undefined}
        >
          Authorize Robinhood
        </a>

        {status?.manualCompletionRequired ? (
          <div className="banner" style={{ marginTop: 14 }}>
            <span className="banner__glyph">1</span>
            <div style={{ width: '100%' }}>
              <strong className="banner__title">Desktop callback handoff</strong>
              <p className="meta" style={{ marginTop: 4 }}>
                Authorization opens in a new tab. After approval, Robinhood may send that tab to a localhost address. The page can say it cannot connect — copy the complete localhost URL from the address bar and paste it below.
              </p>
              <label className="field" style={{ marginTop: 10 }}>
                <span className="field__label">Robinhood localhost callback URL</span>
                <input
                  type="url"
                  autoComplete="off"
                  placeholder="http://localhost:1455/callback?code=…&state=…"
                  value={callbackUrl}
                  disabled={busy}
                  onChange={(event) => setCallbackUrl(event.target.value)}
                />
                <span className="field__hint">The authorization code is single-use and is exchanged server-side with PKCE. DAHCorp does not log or display the resulting token.</span>
              </label>
              <button
                className="btn btn--gold"
                type="button"
                style={{ marginTop: 10 }}
                disabled={busy || !callbackUrl.trim()}
                onClick={completeAuthorization}
              >
                {busy ? 'Connecting…' : 'Complete Robinhood connection'}
              </button>
            </div>
          </div>
        ) : null}

        {message ? <p className="meta" style={{ marginTop: 10 }}>{message}</p> : null}
      </Card>
    );
  }

  const badge = status.executionMode === 'shadow'
    ? { tone: 'ice' as const, glyph: '◌', label: 'Shadow mode' }
    : status.executionEnabled
      ? { tone: 'positive' as const, glyph: '✓', label: 'Human-approved live' }
      : { tone: 'warning' as const, glyph: '—', label: 'Read only' };

  return (
    <Card
      label="Robinhood Agentic"
      title="Growth strategy execution"
      tone="accent"
      action={<Badge tone={badge.tone} glyph={badge.glyph}>{badge.label}</Badge>}
      hint="Robinhood Agentic is the active growth/tactical lane. Cash can wait in queue; a deposit never forces a purchase. Live tactical sells remain disabled while Shadow Mode validates the recycling engine."
    >
      <div className="grid grid--2" style={{ marginBottom: 16 }}>
        <div>
          <p className="meta">Live {activeSymbol} mark</p>
          <p className="figure figure--sm figure--gold">{selectedQuote ? formatMoney(selectedQuote.price) : '—'}</p>
          {selectedQuote?.bid != null && selectedQuote?.ask != null ? <p className="meta">Bid {formatMoney(selectedQuote.bid)} · Ask {formatMoney(selectedQuote.ask)}</p> : null}
        </div>
        <div>
          <p className="meta">Agentic cash queue</p>
          <p className="figure figure--sm">{selectedAccount ? formatMoney(selectedAccount.cash) : '—'}</p>
          <p className="meta">Cash remains deployable only when a qualified strategy signal passes deterministic risk policy.</p>
        </div>
      </div>

      <div className="grid grid--2" style={{ gap: 12, marginBottom: 12 }}>
        <label className="field">
          <span className="field__label">Strategy symbol</span>
          <select
            value={activeSymbol}
            onChange={(event) => {
              setSymbol(event.target.value);
              setPreview(null);
              setExecution(null);
            }}
          >
            {status.allowlist.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Robinhood account</span>
          <select value={selectedId} onChange={(event) => { setAccountId(event.target.value); setPreview(null); }}>
            {status.accounts.map((account) => <option key={account.id} value={account.id} disabled={!account.tradeEligible}>{account.name}{account.tradeEligible ? ' · Agentic' : ' · read only'}</option>)}
          </select>
        </label>
      </div>

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
          <span className="field__hint">Current live BUY surface is constrained to the approved Agentic strategy universe. Tactical selling stays Shadow-only for now.</span>
        </label>
        <button className="btn btn--gold btn--block" type="button" disabled={!status.executionEnabled || !selectedAccount?.tradeEligible || !selectedQuote || busy} onClick={createPreview}>
          {busy ? 'Checking…' : `Preview ${activeSymbol} buy`}
        </button>
      </div>

      {!status.executionEnabled ? (
        <div className="banner"><span className="banner__glyph">{status.executionMode === 'shadow' ? '◌' : '—'}</span><div><strong className="banner__title">{status.executionMode === 'shadow' ? 'Shadow Mode is collecting evidence' : 'Robinhood execution flag is off'}</strong>{status.note}</div></div>
      ) : null}

      {preview ? (
        <div className={`banner ${preview.approved ? 'banner--intel' : 'banner--risk'}`} style={{ marginTop: 14 }}>
          <span className="banner__glyph">{preview.approved ? '✓' : '!'}</span>
          <div style={{ width: '100%' }}>
            <strong className="banner__title">{preview.quantity} {preview.symbol} · estimated {formatMoney(preview.estimatedTotal)}</strong>
            <p className="meta" style={{ marginTop: 4 }}>Live price {formatMoney(preview.quote.price)} · preview expires in 5 minutes. Market orders can fill at a different price.</p>
            {preview.brokerPreview?.warnings.map((warning) => <p key={warning} className="meta" style={{ marginTop: 4 }}>{warning}</p>)}
            {preview.findings.filter((finding) => finding.severity === 'block').map((finding) => <p key={finding.code} className="meta" style={{ marginTop: 4 }}>{finding.message}</p>)}
            {preview.approved && preview.previewId && preview.confirmationText ? (
              <div style={{ marginTop: 12 }}>
                <label className="field"><span className="field__label">Type {preview.confirmationText} to place this order</span><input type="text" autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
                <button className="btn btn--danger" type="button" style={{ marginTop: 10 }} disabled={busy || confirmation.trim().toUpperCase() !== preview.confirmationText} onClick={execute}>
                  {busy ? 'Submitting…' : `Confirm & place ${preview.symbol} order`}
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
