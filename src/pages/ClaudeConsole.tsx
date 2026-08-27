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
  if (!legs.length) return <p className="meta">No allocation legs proposed.</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Amount</th>
            <th scope="col">Account</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, i) => (
            <tr key={`${leg.symbol}-${i}`}>
              <th scope="row">{leg.symbol}</th>
              <td className="num">{formatMoney(leg.amount, 0)}</td>
              <td>{leg.accountId}</td>
              <td>{leg.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskVerdict({ decision }: { decision: RiskDecision }) {
  return (
    <Card
      label="Deterministic risk engine"
      title={decision.approved ? 'Allocation permitted' : 'Allocation blocked or reduced'}
      tone={decision.approved ? 'default' : 'risk'}
      action={
        <Badge tone={decision.approved ? 'positive' : 'negative'} glyph={decision.approved ? '✓' : '✕'}>
          {decision.approved ? 'Approved by policy' : 'Rejected by policy'}
        </Badge>
      }
      hint="Claude cannot bypass this engine. Every recommendation is validated against cash, reserves, position and sleeve limits, leverage ceilings and order size before it can even be previewed."
    >
      <div className="grid grid--2" style={{ gap: 'var(--space-2)' }}>
        <KeyValue label="Requested">{formatMoney(decision.requestedTotal, 0)}</KeyValue>
        <KeyValue label="Allowed">{formatMoney(decision.allowedTotal, 0)}</KeyValue>
        <KeyValue label="Execution phase">{decision.executionPhase}</KeyValue>
        <KeyValue label="Execution enabled">{decision.executionEnabled ? 'Yes' : 'No — disabled in this build'}</KeyValue>
      </div>

      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
        <span>Batch findings</span>
      </p>
      <RiskFindingList findings={decision.findings} />

      {decision.orders.length ? (
        <>
          <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
            <span>Per-order validation</span>
          </p>
          <div className="stack stack--tight">
            {decision.orders.map((validated) => (
              <div key={validated.order.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--space-3)' }}>
                <div className="row row--between">
                  <strong>
                    {validated.order.side} {validated.order.symbol} · {formatMoney(validated.allowedNotional, 0)} allowed
                  </strong>
                  <Badge tone={validated.approved ? 'positive' : 'negative'} glyph={validated.approved ? '✓' : '✕'}>
                    {validated.approved ? 'Approved' : 'Rejected'}
                  </Badge>
                </div>
                <div className="grid grid--2" style={{ gap: 'var(--space-2)' }}>
                  <KeyValue label="Post-trade weight">{formatPct(validated.impact.postTradeWeight, 1)}</KeyValue>
                  <KeyValue label="Post-trade leveraged sleeve">
                    {formatPct(validated.impact.postTradeLeveragedPct, 1)}
                  </KeyValue>
                  <KeyValue label="Post-trade cash">{formatMoney(validated.impact.postTradeCash)}</KeyValue>
                  <KeyValue label="Forward income delta">
                    {validated.impact.forwardMonthlyIncomeDelta == null
                      ? '—'
                      : `${formatMoney(validated.impact.forwardMonthlyIncomeDelta)}/mo`}
                  </KeyValue>
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

function BriefCard({ brief, source, model, fallbackReason }: {
  brief: RecommendationBrief;
  source: string;
  model: string | null;
  fallbackReason: string | null;
}) {
  const confidence = CONFIDENCE[brief.confidence] ?? CONFIDENCE.low;
  return (
    <Card
      label="Recommendation"
      title={brief.headline}
      tone="intel"
      action={
        <div className="row" style={{ gap: 8 }}>
          <Badge tone={confidence.tone} glyph={confidence.glyph}>
            {brief.confidence} confidence
          </Badge>
          <Badge tone={source === 'claude' ? 'intel' : 'neutral'} glyph={source === 'claude' ? '◆' : '⚙'}>
            {source === 'claude' ? `Claude · ${model ?? 'model'}` : 'Deterministic policy'}
          </Badge>
        </div>
      }
    >
      {fallbackReason ? (
        <div className="banner banner--intel" role="note">
          <span className="banner__glyph" aria-hidden="true">
            i
          </span>
          <div>
            <span className="banner__title">Produced by the deterministic engine</span>
            <span>{fallbackReason}</span>
          </div>
        </div>
      ) : null}

      <p>{brief.thesis}</p>

      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
        <span>Proposed allocation</span>
      </p>
      <LegTable legs={brief.legs} />

      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
        <span>Effect on the milestone</span>
      </p>
      <p>{brief.etaImpact}</p>

      <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
        <span>What would make this wrong</span>
      </p>
      {brief.risks.length ? (
        <ul className="bullets">
          {brief.risks.map((risk) => (
            <li key={risk}>
              <span aria-hidden="true">▲ </span>
              {risk}
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">No risks were articulated, which is itself a reason to be sceptical of this brief.</p>
      )}

      {brief.alternative ? (
        <>
          <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
            <span>Alternative allocation</span>
          </p>
          <p>{brief.alternative.summary}</p>
          <LegTable legs={brief.alternative.legs} />
          <p className="meta">Trade-off: {brief.alternative.tradeoff}</p>
        </>
      ) : null}

      {brief.notes.length ? (
        <>
          <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
            <span>Notes</span>
          </p>
          <ul className="bullets">
            {brief.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : null}

      {brief.dataCaveats.length ? (
        <>
          <p className="card__label" style={{ marginTop: 'var(--space-4)' }}>
            <span>Data caveats</span>
          </p>
          <ul className="bullets">
            {brief.dataCaveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </>
      ) : null}
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
    setQuestion(q);
    setBusy(true);
    setError(null);
    setDecision(null);
    setPreviewNote(null);
    try {
      const parsed = capital.trim() === '' ? undefined : Number(capital);
      setResult(await api.analyze(q, Number.isFinite(parsed) ? parsed : undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Analysis failed.', 0, 'UNKNOWN'));
    } finally {
      setBusy(false);
    }
  }

  async function record(action: 'approved' | 'rejected' | 'edited') {
    if (!result?.recommendationId) return;
    try {
      await api.recordDecision(result.recommendationId, action);
      setDecision(action);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Could not record the decision.', 0, 'UNKNOWN'));
    }
  }

  async function previewOrders() {
    if (!result) return;
    setPreviewNote(null);
    try {
      const response = await api.orderPreview(
        result.brief.legs.map((leg) => ({
          accountId: leg.accountId,
          symbol: leg.symbol,
          side: 'buy' as const,
          notional: leg.amount,
          rationale: leg.reason,
          origin: 'claude',
        })),
        result.recommendationId,
      );
      setPreviewNote(response.note);
    } catch (err) {
      setPreviewNote(err instanceof ApiError ? err.message : 'Order preview failed.');
    }
  }

  const model = session.data?.environment.model ?? null;

  return (
    <>
      <PageHead
        eyebrow="Claude"
        title="Portfolio strategist"
        lede="Claude interprets the deterministic signals and proposes where capital should go. It cannot place an order, change a limit, or move a dollar — every proposal is validated by the risk engine before it can be previewed."
        action={
          <Badge tone={model ? 'intel' : 'warning'} glyph={model ? '◆' : '▲'}>
            {model ? model : 'No model configured'}
          </Badge>
        }
      />

      <Card label="Ask" title="Put a question to the strategist">
        <div className="field">
          <label className="field__label" htmlFor="question">
            Question
          </label>
          <textarea
            id="question"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="capital">
            Capital to allocate (optional)
          </label>
          <input
            id="capital"
            type="number"
            min={0}
            step={25}
            value={capital}
            placeholder="Defaults to investable cash above the reserve"
            onChange={(e) => setCapital(e.target.value)}
            disabled={busy}
          />
          <p className="field__hint">
            Bounded server-side by investable cash. Capital inside the liquidity reserve is never offered for allocation.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--gold" onClick={() => void ask()} disabled={busy || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask for a recommendation'}
          </button>
        </div>

        {result?.standingQuestions?.length ? (
          <>
            <p className="card__label" style={{ marginTop: 'var(--space-5)' }}>
              <span>Standing questions</span>
            </p>
            <div className="chip-group">
              {result.standingQuestions.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => void ask(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </Card>

      {error ? (
        <div className="section">
          <ErrorState error={error} onRetry={() => void ask()} />
        </div>
      ) : null}

      {busy && !result ? (
        <div className="section">
          <LoadingBlock rows={4} label="Consulting the strategist" />
        </div>
      ) : null}

      {result ? (
        <>
          <div className="section">
            <BriefCard
              brief={result.brief}
              source={result.source}
              model={result.model}
              fallbackReason={result.fallbackReason}
            />
          </div>

          <div className="section">
            <RiskVerdict decision={result.riskDecision} />
          </div>

          <div className="grid grid--2 section">
            <Card label="Human decision" title="Approve, reject or edit">
              <p className="meta">
                Recording a decision writes it to the audit log with the portfolio snapshot the recommendation was based
                on. Approval records intent — it does not execute anything in this build.
              </p>
              <div className="row" style={{ marginTop: 'var(--space-4)' }}>
                <button type="button" className="btn btn--gold btn--sm" onClick={() => void record('approved')} disabled={!result.recommendationId || decision != null}>
                  Approve
                </button>
                <button type="button" className="btn btn--sm" onClick={() => void record('edited')} disabled={!result.recommendationId || decision != null}>
                  Edit
                </button>
                <button type="button" className="btn btn--danger btn--sm" onClick={() => void record('rejected')} disabled={!result.recommendationId || decision != null}>
                  Reject
                </button>
              </div>
              {decision ? (
                <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
                  <span aria-hidden="true">✓ </span>
                  Recorded as <strong>{decision}</strong>. Nothing was sent to a broker.
                </p>
              ) : null}
              {!result.recommendationId ? (
                <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
                  No database is attached, so this recommendation was not persisted and cannot be decided on.
                </p>
              ) : null}
            </Card>

            <Card label="Trade preview" title="Validate, never execute" tone="risk">
              <p className="meta">{result.phaseNote}</p>
              <div className="row" style={{ marginTop: 'var(--space-4)' }}>
                <button type="button" className="btn btn--sm" onClick={() => void previewOrders()} disabled={!result.brief.legs.length}>
                  Build trade preview
                </button>
                <Badge tone="negative" glyph="✕">
                  Execution disabled
                </Badge>
              </div>
              {previewNote ? (
                <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
                  {previewNote}
                </p>
              ) : null}
              <p className="meta" style={{ marginTop: 'var(--space-3)' }}>
                The execute endpoint contains no broker client. It is not a flag that could be flipped by accident —
                there is no code path to a live order in this build.
              </p>
            </Card>
          </div>

          <div className="section">
            <Card label="Baseline" title="What the deterministic policy would do on its own" hint="Shown alongside Claude's brief so the model's contribution is always separable from the rules.">
              <LegTable
                legs={result.baseline.plan.legs.map((leg) => ({
                  symbol: leg.symbol,
                  amount: leg.amount,
                  accountId: leg.accountId,
                  reason: leg.reason,
                }))}
              />
              <ul className="bullets" style={{ marginTop: 'var(--space-3)' }}>
                {result.baseline.plan.reasoning.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {result.baseline.plan.constraints.length ? (
                <ul className="bullets">
                  {result.baseline.plan.constraints.map((line) => (
                    <li key={line}>
                      <span aria-hidden="true">▲ </span>
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
              {result.baseline.plan.reserved > 0 ? (
                <p className="meta">
                  {formatMoney(result.baseline.plan.reserved, 0)} deliberately left uninvested.{' '}
                  {result.baseline.plan.reservedReason}
                </p>
              ) : null}
            </Card>
          </div>
        </>
      ) : !busy && !error ? (
        <div className="section">
          <EmptyState title="No recommendation yet">
            Ask a question above. Every answer is stored with the exact portfolio snapshot it was based on.
          </EmptyState>
        </div>
      ) : null}
    </>
  );
}
