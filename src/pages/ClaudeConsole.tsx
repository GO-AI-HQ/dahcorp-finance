import { useState } from 'react';
import { api, ApiError, type AnalyzeResponse } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge, type BadgeTone } from '../components/Badge.js';
import { KeyValue } from '../components/KeyValue.js';
import { EmptyState, ErrorState, LoadingBlock } from '../components/States.js';
import { RiskFindingList } from '../components/SignalBadges.js';
import { formatMoney, formatPct } from '../core/format.js';
import type { RecommendationBrief, RecommendedLeg } from '../agent/types.js';
import type { RiskDecision } from '../risk/types.js';

const CONFIDENCE: Record<string, { tone: BadgeTone; glyph: string }> = {
  high: { tone: 'positive', glyph: '▲' },
  medium: { tone: 'ice', glyph: '=' },
  low: { tone: 'warning', glyph: '▼' },
};

function LegTable({ legs }: { legs: RecommendedLeg[] }) {
  if (!legs.length) return <p className="meta">No money move is being proposed.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th scope="col">Symbol</th><th scope="col">Amount</th><th scope="col">Account</th><th scope="col">Why</th></tr></thead>
        <tbody>
          {legs.map((leg, i) => (
            <tr key={`${leg.symbol}-${i}`}><th scope="row">{leg.symbol}</th><td className="num">{formatMoney(leg.amount, 0)}</td><td>{leg.accountId}</td><td>{leg.reason}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskVerdict({ decision }: { decision: RiskDecision }) {
  return (
    <Card
      label="Safety checks"
      title={decision.approved ? 'This proposal fits your current rules' : 'This proposal was blocked or reduced'}
      tone={decision.approved ? 'default' : 'risk'}
      action={<Badge tone={decision.approved ? 'positive' : 'negative'} glyph={decision.approved ? '✓' : '✕'}>{decision.approved ? 'Allowed by your rules' : 'Blocked by your rules'}</Badge>}
      hint="The strategist cannot bypass these checks. Proposed moves are compared with the cash actually available, position limits, high-risk investment limits, ownership records and maximum order size before anything can reach a broker preview."
    >
      <div className="grid grid--2" style={{ gap: 'var(--space-2)' }}>
        <KeyValue label="Requested">{formatMoney(decision.requestedTotal, 0)}</KeyValue>
        <KeyValue label="Allowed">{formatMoney(decision.allowedTotal, 0)}</KeyValue>
        <KeyValue label="Current phase">{decision.executionPhase}</KeyValue>
        <KeyValue label="Can this screen place a trade?">{decision.executionEnabled ? 'Yes' : 'No — recommendation only'}</KeyValue>
      </div>

      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>What the rules found</span></p>
      <RiskFindingList findings={decision.findings} />

      {decision.orders.length ? (
        <>
          <p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>Each proposed move</span></p>
          <div className="stack stack--tight">
            {decision.orders.map((validated) => (
              <div key={validated.order.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--space-3)' }}>
                <div className="row row--between">
                  <strong>{validated.order.side} {validated.order.symbol} · {formatMoney(validated.allowedNotional, 0)} allowed</strong>
                  <Badge tone={validated.approved ? 'positive' : 'negative'} glyph={validated.approved ? '✓' : '✕'}>{validated.approved ? 'Allowed' : 'Blocked'}</Badge>
                </div>
                <div className="grid grid--2" style={{ gap: 'var(--space-2)' }}>
                  <KeyValue label="Share of portfolio afterward">{formatPct(validated.impact.postTradeWeight, 1)}</KeyValue>
                  <KeyValue label="High-risk investments afterward">{formatPct(validated.impact.postTradeLeveragedPct, 1)}</KeyValue>
                  <KeyValue label="Cash afterward">{formatMoney(validated.impact.postTradeCash)}</KeyValue>
                  <KeyValue label="Change in monthly income">{validated.impact.forwardMonthlyIncomeDelta == null ? '—' : `${formatMoney(validated.impact.forwardMonthlyIncomeDelta)}/mo`}</KeyValue>
                </div>
                <RiskFindingList findings={validated.findings} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}

function BriefCard({ brief, source, model, fallbackReason }: { brief: RecommendationBrief; source: string; model: string | null; fallbackReason: string | null }) {
  const confidence = CONFIDENCE[brief.confidence] ?? CONFIDENCE.low;
  const sourceLabel = source === 'openai' ? 'Strategist' : source === 'claude' ? 'Research Analyst' : 'Safety rules';
  const sourceTone: BadgeTone = source === 'openai' || source === 'claude' ? 'intel' : 'neutral';
  return (
    <Card
      label="Recommendation"
      title={brief.headline}
      tone="intel"
      action={<div className="row" style={{ gap: 8 }}><Badge tone={confidence.tone} glyph={confidence.glyph}>{brief.confidence} confidence</Badge><Badge tone={sourceTone} glyph={source === 'openai' || source === 'claude' ? '◆' : '⚙'} title={model ?? undefined}>{sourceLabel}</Badge></div>}
    >
      {fallbackReason ? <div className="banner banner--intel" role="note"><span className="banner__glyph" aria-hidden="true">i</span><div><span className="banner__title">Rules-only answer used</span><span>{fallbackReason}</span></div></div> : null}
      <p>{brief.thesis}</p>
      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>Proposed moves</span></p>
      <LegTable legs={brief.legs} />
      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>Effect on your goal</span></p>
      <p>{brief.etaImpact}</p>
      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>What could make this wrong</span></p>
      {brief.risks.length ? <ul className="bullets">{brief.risks.map((risk) => <li key={risk}><span aria-hidden="true">▲ </span>{risk}</li>)}</ul> : <p className="meta">No risks were identified, which is itself a reason to be cautious about this answer.</p>}
      {brief.alternative ? <><p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>Another reasonable choice</span></p><p>{brief.alternative.summary}</p><LegTable legs={brief.alternative.legs} /><p className="meta">Trade-off: {brief.alternative.tradeoff}</p></> : null}
      {brief.notes.length ? <><p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>Notes</span></p><ul className="bullets">{brief.notes.map((note) => <li key={note}>{note}</li>)}</ul></> : null}
      {brief.dataCaveats.length ? <><p className="card__label" style={{ marginTop: 'var(--space-4)' }}><span>What data may be missing or uncertain</span></p><ul className="bullets">{brief.dataCaveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></> : null}
    </Card>
  );
}

export function ClaudeConsole() {
  const session = useResource(() => api.session(), []);
  const [question, setQuestion] = useState('Where should the next dollar go?');
  const [capital, setCapital] = useState<string>('');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  async function ask(nextQuestion?: string) {
    const q = (nextQuestion ?? question).trim();
    if (!q || busy) return;
    setQuestion(q); setBusy(true); setError(null); setDecision(null); setPreviewNote(null);
    try {
      const parsed = capital.trim() === '' ? undefined : Number(capital);
      setResult(await api.analyze(q, Number.isFinite(parsed) ? parsed : undefined));
    } catch (err) { setError(err instanceof ApiError ? err : new ApiError('Could not complete the recommendation.', 0, 'UNKNOWN')); }
    finally { setBusy(false); }
  }

  async function record(action: 'approved' | 'rejected' | 'edited') {
    if (!result?.recommendationId) return;
    try { await api.recordDecision(result.recommendationId, action); setDecision(action); }
    catch (err) { setError(err instanceof ApiError ? err : new ApiError('Could not record the decision.', 0, 'UNKNOWN')); }
  }

  async function previewOrders() {
    if (!result) return;
    setPreviewNote(null);
    try {
      const response = await api.orderPreview(result.brief.legs.map((leg) => ({ accountId: leg.accountId, symbol: leg.symbol, side: 'buy' as const, notional: leg.amount, rationale: leg.reason, origin: 'agent' })), result.recommendationId);
      setPreviewNote(response.note);
    } catch (err) { setPreviewNote(err instanceof ApiError ? err.message : 'Could not build the preview.'); }
  }

  const model = session.data?.environment.model ?? null;
  const modelProvider = session.data?.environment.modelProvider ?? null;

  return (
    <>
      <PageHead
        eyebrow="Strategist"
        title="Ask about your money and portfolio"
        lede="The strategist uses your current portfolio, cash, goals and market information to make a recommendation. It cannot change your safety rules or move money on its own; every proposed move is checked before it can reach a broker preview."
        action={<Badge tone={model ? 'intel' : 'warning'} glyph={model ? '◆' : '▲'} title={model ? `${modelProvider ?? 'model'} · ${model}` : 'Rules-only fallback'}>{model ? 'Live strategist' : 'Rules-only answer'}</Badge>}
      />

      <Card label="Ask" title="What do you want help deciding?">
        <div className="field"><label className="field__label" htmlFor="question">Question</label><textarea id="question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy} /></div>
        <div className="field">
          <label className="field__label" htmlFor="capital">Money to consider (optional)</label>
          <input id="capital" type="number" min={0} step={25} value={capital} placeholder="Uses available brokerage cash if left blank" onChange={(e) => setCapital(e.target.value)} disabled={busy} />
          <p className="field__hint">The amount is capped by cash that is actually available in the relevant brokerage accounts. Your protected household savings is never offered for investing here.</p>
        </div>
        <div className="row"><button type="button" className="btn btn--gold" onClick={() => void ask()} disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Get a recommendation'}</button></div>
        {result?.standingQuestions?.length ? <><p className="card__label" style={{ marginTop: 'var(--space-5)' }}><span>Other useful questions</span></p><div className="chip-group">{result.standingQuestions.map((q) => <button key={q} type="button" className="chip" onClick={() => void ask(q)} disabled={busy}>{q}</button>)}</div></> : null}
      </Card>

      {error ? <div className="section"><ErrorState error={error} onRetry={() => void ask()} /></div> : null}
      {busy && !result ? <div className="section"><LoadingBlock rows={4} label="Working through your options" /></div> : null}

      {result ? (
        <>
          <div className="section"><BriefCard brief={result.brief} source={result.source} model={result.model} fallbackReason={result.fallbackReason} /></div>
          <div className="section"><RiskVerdict decision={result.riskDecision} /></div>
          <div className="grid grid--2 section">
            <Card label="Your decision" title="Approve, reject or edit the recommendation">
              <p className="meta">Saving your decision keeps a record of what you chose and the portfolio information the recommendation was based on. Approving the idea does not skip the broker checks or your confirmation settings.</p>
              <div className="row" style={{ marginTop: 'var(--space-4)' }}><button type="button" className="btn btn--gold btn--sm" onClick={() => void record('approved')} disabled={!result.recommendationId || decision != null}>Approve</button><button type="button" className="btn btn--sm" onClick={() => void record('edited')} disabled={!result.recommendationId || decision != null}>Edit</button><button type="button" className="btn btn--danger btn--sm" onClick={() => void record('rejected')} disabled={!result.recommendationId || decision != null}>Reject</button></div>
              {decision ? <p className="meta" style={{ marginTop: 'var(--space-3)' }}><span aria-hidden="true">✓ </span>Recorded as <strong>{decision}</strong>.</p> : null}
              {!result.recommendationId ? <p className="meta" style={{ marginTop: 'var(--space-3)' }}>There is no attached database right now, so this recommendation could not be saved.</p> : null}
            </Card>

            <Card label="Safety preview" title="Check the proposal before it reaches a broker" tone="risk">
              <p className="meta">{result.phaseNote}</p>
              <div className="row" style={{ marginTop: 'var(--space-4)' }}><button type="button" className="btn btn--sm" onClick={() => void previewOrders()} disabled={!result.brief.legs.length}>Build safety preview</button><Badge tone="ice" glyph="◌">Practice mode</Badge></div>
              {previewNote ? <p className="meta" style={{ marginTop: 'var(--space-3)' }}>{previewNote}</p> : null}
              <p className="meta" style={{ marginTop: 'var(--space-3)' }}>This preview does not submit a broker order. Schwab and Robinhood use separate broker checks and confirmation steps.</p>
            </Card>
          </div>

          <div className="section">
            <Card label="Rules-only comparison" title="What your safety rules would suggest without the strategist" hint="This lets you see what the strategist added beyond the standing rules.">
              <LegTable legs={result.baseline.plan.legs.map((leg) => ({ symbol: leg.symbol, amount: leg.amount, accountId: leg.accountId, reason: leg.reason }))} />
              <ul className="bullets" style={{ marginTop: 'var(--space-3)' }}>{result.baseline.plan.reasoning.map((line) => <li key={line}>{line}</li>)}</ul>
              {result.baseline.plan.constraints.length ? <ul className="bullets">{result.baseline.plan.constraints.map((line) => <li key={line}><span aria-hidden="true">▲ </span>{line}</li>)}</ul> : null}
              {result.baseline.plan.reserved > 0 ? <p className="meta">{formatMoney(result.baseline.plan.reserved, 0)} deliberately left uninvested. {result.baseline.plan.reservedReason}</p> : null}
            </Card>
          </div>
        </>
      ) : !busy && !error ? <div className="section"><EmptyState title="No recommendation yet">Ask a question above. Every saved answer is tied to the portfolio information it was based on.</EmptyState></div> : null}
    </>
  );
}
