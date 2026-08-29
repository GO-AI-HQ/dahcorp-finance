import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type AdoptStrategyResponse,
  type ModelStrategyResponse,
  type SchwabExecutionResponse,
  type SchwabTradePreviewResponse,
  type SimulationResponse,
} from '../services/api.js';
import {
  robinhoodApi,
  type RobinhoodExecutionResponse,
  type RobinhoodTradePreviewResponse,
} from '../services/robinhoodApi.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge } from '../components/Badge.js';
import { StatCard } from '../components/StatCard.js';
import { ProjectionChart, type ProjectionSeries } from '../charts/ProjectionChart.js';
import { CHART } from '../charts/theme.js';
import { formatMoney, formatShares, formatSignedMoney } from '../core/format.js';

const SCENARIO_NAME: Record<string, string> = {
  conservative: 'Conservative outcome',
  base: 'Current modeled path',
  aggressive: 'Higher-rate illustration',
};
const SCENARIO_COLOR: Record<string, string> = {
  conservative: CHART.ice,
  base: CHART.gold,
  aggressive: CHART.positive,
};

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function legKey(index: number, symbol: string, side: string): string {
  return `${index}:${side}:${symbol}`;
}

export function ModelingLab() {
  const [params] = useSearchParams();
  const eventFingerprint = params.get('event');
  const initialQuestion = params.get('question')
    ?? (params.get('symbol')
      ? `Should the active strategy ${params.get('side')?.toUpperCase() ?? 'BUY'} ${params.get('symbol')} now, and if so how much?`
      : 'What is the best use of the relevant strategy cash right now?');

  const [question, setQuestion] = useState(initialQuestion);
  const [capitalText, setCapitalText] = useState(params.get('amount') ?? '');
  const [horizonMonths, setHorizonMonths] = useState(36);
  const [baseSimulation, setBaseSimulation] = useState<SimulationResponse | null>(null);
  const [result, setResult] = useState<ModelStrategyResponse | null>(null);
  const [adopted, setAdopted] = useState<AdoptStrategyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rhPreviews, setRhPreviews] = useState<Record<string, RobinhoodTradePreviewResponse>>({});
  const [rhConfirmations, setRhConfirmations] = useState<Record<string, string>>({});
  const [rhExecutions, setRhExecutions] = useState<Record<string, RobinhoodExecutionResponse>>({});
  const [schwabPreviews, setSchwabPreviews] = useState<Record<string, SchwabTradePreviewResponse>>({});
  const [schwabConfirmations, setSchwabConfirmations] = useState<Record<string, string>>({});
  const [schwabExecutions, setSchwabExecutions] = useState<Record<string, SchwabExecutionResponse>>({});

  useEffect(() => {
    let alive = true;
    api.simulate({ horizonMonths })
      .then((response) => { if (alive) setBaseSimulation(response); })
      .catch(() => { if (alive) setBaseSimulation(null); });
    return () => { alive = false; };
  }, [horizonMonths]);

  const series = useMemo<ProjectionSeries[]>(() => {
    const normal = (baseSimulation?.scenarios ?? []).map((scenario) => ({
      name: SCENARIO_NAME[scenario.name] ?? scenario.label,
      color: SCENARIO_COLOR[scenario.name] ?? CHART.ice,
      points: scenario.projection.months.map((month) => ({ month: month.month, monthlyIncome: month.monthlyIncome })),
    }));
    if (!result) return normal;
    return [...normal, {
      name: 'Proposed Model',
      color: CHART.intel,
      points: result.proposedProjection.months.map((month) => ({ month: month.month, monthlyIncome: month.monthlyIncome })),
    }];
  }, [baseSimulation, result]);

  function resetExecutionState() {
    setAdopted(null);
    setRhPreviews({});
    setRhExecutions({});
    setSchwabPreviews({});
    setSchwabExecutions({});
  }

  async function runModel() {
    if (!question.trim()) return;
    setBusy(true);
    setMessage(null);
    resetExecutionState();
    try {
      const parsed = capitalText.trim() ? Number(capitalText) : undefined;
      const modeled = await api.modelStrategy({
        question: question.trim(),
        eventFingerprint: eventFingerprint ?? undefined,
        capital: parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined,
        horizonMonths,
      });
      setResult(modeled);
      if (modeled.fallbackReason) setMessage(modeled.fallbackReason);
    } catch (error) {
      setResult(null);
      setMessage(messageFor(error, 'The Modeling Lab could not build this strategy.'));
    } finally {
      setBusy(false);
    }
  }

  async function adopt() {
    if (!result?.recommendationId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.adoptStrategy(result.recommendationId, result.event?.fingerprint ?? eventFingerprint);
      setAdopted(response);
      setMessage(response.note);
    } catch (error) {
      setMessage(messageFor(error, 'The modeled strategy could not be adopted.'));
    } finally {
      setBusy(false);
    }
  }

  async function previewRobinhood(index: number) {
    if (!result) return;
    const validated = result.riskDecision.orders[index];
    if (!validated?.approved || validated.order.broker !== 'robinhood' || validated.allowedNotional <= 0) return;
    const key = legKey(index, validated.order.symbol, validated.order.side);
    setBusy(true);
    setMessage(null);
    try {
      const preview = await robinhoodApi.preview({
        accountId: validated.order.accountId,
        symbol: validated.order.symbol,
        side: validated.order.side,
        notional: validated.allowedNotional,
        rationale: validated.order.rationale,
        recommendationId: result.recommendationId,
      });
      setRhPreviews((current) => ({ ...current, [key]: preview }));
      setRhConfirmations((current) => ({ ...current, [key]: '' }));
    } catch (error) {
      setMessage(messageFor(error, `The live ${validated.order.symbol} Robinhood preview could not be created.`));
    } finally {
      setBusy(false);
    }
  }

  async function executeRobinhood(key: string) {
    const preview = rhPreviews[key];
    if (!preview?.previewId) return;
    setBusy(true);
    setMessage(null);
    try {
      const execution = await robinhoodApi.execute(preview.previewId, rhConfirmations[key] ?? '');
      setRhExecutions((current) => ({ ...current, [key]: execution }));
      setRhPreviews((current) => { const next = { ...current }; delete next[key]; return next; });
      setMessage(execution.order.message);
    } catch (error) {
      setMessage(messageFor(error, 'The Robinhood order could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  async function previewSchwab(index: number) {
    if (!result) return;
    const validated = result.riskDecision.orders[index];
    if (!validated?.approved || validated.order.broker !== 'schwab' || validated.order.symbol !== 'YMAG' || validated.order.side !== 'buy') return;
    const price = validated.estimatedPrice ?? 0;
    const shares = price > 0 ? Math.floor(validated.allowedNotional / price) : 0;
    if (shares < 1) {
      setMessage('The modeled YMAG amount is below one whole Schwab share at the current price. Add cash or increase the modeled amount before creating a live Schwab preview.');
      return;
    }
    const key = legKey(index, validated.order.symbol, validated.order.side);
    setBusy(true);
    setMessage(null);
    try {
      const preview = await api.schwabTradePreview(validated.order.accountId, shares);
      setSchwabPreviews((current) => ({ ...current, [key]: preview }));
      setSchwabConfirmations((current) => ({ ...current, [key]: '' }));
    } catch (error) {
      setMessage(messageFor(error, 'The live Schwab YMAG preview could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  async function executeSchwab(key: string) {
    const preview = schwabPreviews[key];
    if (!preview?.previewId) return;
    setBusy(true);
    setMessage(null);
    try {
      const execution = await api.executeOrder(preview.previewId, schwabConfirmations[key] ?? '');
      setSchwabExecutions((current) => ({ ...current, [key]: execution }));
      setSchwabPreviews((current) => { const next = { ...current }; delete next[key]; return next; });
      setMessage(execution.order.message);
    } catch (error) {
      setMessage(messageFor(error, 'The Schwab order could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Modeling Lab"
        title="Turn a market idea into a concrete treasury decision"
        lede="Modeling Lab combines current portfolio state, relevant intelligence, Claude research, the Treasury Agent and deterministic policy. It can stage or preview real transactions; nothing reaches a broker without explicit final confirmation."
        action={<Badge tone="intel">Decision workspace</Badge>}
      />

      <div className="grid grid--wide-left section">
        <Card label="Decision to model" title="What are you considering?">
          <div className="stack">
            <label className="field">
              <span className="field__label">Question</span>
              <textarea rows={4} value={question} disabled={busy} onChange={(event) => setQuestion(event.target.value)} />
              <span className="field__hint">Example: “Should we deploy $8 into SEMI now, hold cash, or use SOXL tactically instead?”</span>
            </label>
            <div className="grid grid--2">
              <label className="field"><span className="field__label">Capital to test — optional</span><input type="number" min={0} step={1} placeholder="Use available mandate cash" value={capitalText} disabled={busy} onChange={(event) => setCapitalText(event.target.value)} /></label>
              <label className="field"><span className="field__label">Projection horizon — {horizonMonths} months</span><input type="range" min={6} max={120} step={6} value={horizonMonths} disabled={busy} onChange={(event) => setHorizonMonths(Number(event.target.value))} /></label>
            </div>
            {eventFingerprint ? <div className="banner"><span className="banner__glyph">◆</span><div><strong className="banner__title">Intelligence event attached</strong>The model will research the selected event before proposing capital movement.</div></div> : null}
            <button type="button" className="btn btn--gold" disabled={busy || !question.trim()} onClick={runModel}>{busy ? 'Modeling…' : 'Build Proposed Model'}</button>
          </div>
        </Card>
        <Card label="Execution path" title="Model → Adopt → Preview → Confirm">
          <ol className="bullets">
            <li><strong>Model</strong> tests whether a move improves the mandate.</li>
            <li><strong>Adopt</strong> persists the strategy and stages permitted transaction legs.</li>
            <li><strong>Preview</strong> asks the live broker to review an eligible BUY/SELL with fresh cash, shares and price.</li>
            <li><strong>Confirm</strong> requires the exact phrase before submission.</li>
          </ol>
          <p className="meta">Cross-broker cash transfers remain manual and are stated explicitly.</p>
        </Card>
      </div>

      {result ? (
        <>
          <div className="grid grid--4 section">
            <StatCard label="Capital modeled" value={formatMoney(result.capital)} tone="gold" caption={`${result.mandateAccounts.length} mandate account${result.mandateAccounts.length === 1 ? '' : 's'} considered.`} />
            <StatCard label="Current monthly income" value={`${formatMoney(result.impact.currentMonthlyIncome)}/mo`} caption="Current modeled recurring investment income." />
            <StatCard label="Proposed monthly income" value={`${formatMoney(result.impact.proposedMonthlyIncome)}/mo`} delta={formatSignedMoney(result.impact.monthlyIncomeDelta) + '/mo'} deltaDirection={result.impact.monthlyIncomeDelta > 0 ? 'up' : result.impact.monthlyIncomeDelta < 0 ? 'down' : 'flat'} caption={result.impact.immediateIncomeEffectKnown ? 'Direct modeled Income-engine effect.' : 'Growth/Maritime changes may not create immediate income.'} />
            <StatCard label="Cash remaining" value={formatMoney(result.impact.cashRemaining)} caption="Modeled mandate cash not consumed by permitted BUY legs." />
          </div>

          <Card label="Treasury Agent recommendation" title={result.brief.headline} action={<Badge tone={result.brief.confidence === 'high' ? 'positive' : result.brief.confidence === 'medium' ? 'warning' : 'neutral'}>{result.brief.confidence} confidence</Badge>}>
            <p>{result.brief.thesis}</p>
            <p className="meta" style={{ marginTop: 8 }}>Source: {result.source}{result.model ? ` · ${result.model}` : ''}. {result.note}</p>
            {result.event ? <div className="banner" style={{ marginTop: 12 }}><span className="banner__glyph">◆</span><div><strong className="banner__title">Source event</strong>{result.event.headline} · {result.event.source}</div></div> : null}
            <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--gold" disabled={busy || !result.recommendationId} onClick={adopt}>Adopt as Active Strategy</button>
              <Link className="btn btn--ghost" to="/activity">Activity / audit trail</Link>
            </div>
          </Card>

          <Card label="Goal path" title="Current scenarios + Proposed Model">
            {series.length ? <ProjectionChart series={series} target={baseSimulation?.target ?? 500} /> : <p className="meta">Projection data is not available.</p>}
            <p className="meta" style={{ marginTop: 10 }}>The Proposed Model is a scenario, not a forecast or guarantee.</p>
          </Card>

          <Card label="Transaction plan" title={result.riskDecision.orders.length ? `${result.riskDecision.orders.length} proposed transaction leg${result.riskDecision.orders.length === 1 ? '' : 's'}` : 'HOLD CASH — no transaction required'}>
            {result.riskDecision.orders.length ? (
              <div className="stack">
                {result.riskDecision.orders.map((validated, index) => {
                  const key = legKey(index, validated.order.symbol, validated.order.side);
                  const rhPreview = rhPreviews[key];
                  const schwabPreview = schwabPreviews[key];
                  const canRobinhood = validated.approved && validated.order.broker === 'robinhood';
                  const canSchwab = validated.approved && validated.order.broker === 'schwab' && validated.order.symbol === 'YMAG' && validated.order.side === 'buy';
                  return (
                    <div key={key} className="panel">
                      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <div><strong>{validated.order.side.toUpperCase()} {validated.order.symbol} · {formatMoney(validated.allowedNotional)}</strong><p className="meta">{validated.order.broker} · {validated.order.rationale}</p></div>
                        <Badge tone={validated.approved ? 'positive' : 'negative'}>{validated.approved ? 'Policy permits' : 'Blocked'}</Badge>
                      </div>
                      <p className="meta">Estimated shares {validated.estimatedShares == null ? '—' : formatShares(validated.estimatedShares)} · price {validated.estimatedPrice == null ? '—' : formatMoney(validated.estimatedPrice)} · monthly-income effect {validated.impact.forwardMonthlyIncomeDelta == null ? 'not direct' : `${formatSignedMoney(validated.impact.forwardMonthlyIncomeDelta)}/mo`}.</p>
                      {validated.findings.filter((finding) => finding.severity === 'block').map((finding) => <p key={finding.code} className="meta">{finding.message}</p>)}

                      {canRobinhood && !rhPreviews[key] && !rhExecutions[key] ? <button type="button" className="btn btn--gold" disabled={busy} onClick={() => previewRobinhood(index)}>Preview {validated.order.side.toUpperCase()} {formatMoney(validated.allowedNotional)} {validated.order.symbol}</button> : null}
                      {rhPreview?.confirmationText ? (
                        <div className="banner banner--intel" style={{ marginTop: 10 }}><div style={{ width: '100%' }}><strong>Live Robinhood preview · {rhPreview.side.toUpperCase()} {formatShares(rhPreview.quantity)} {rhPreview.symbol} · est. {formatMoney(rhPreview.estimatedTotal)}</strong><label className="field" style={{ marginTop: 8 }}><span className="field__label">Type {rhPreview.confirmationText}</span><input value={rhConfirmations[key] ?? ''} onChange={(event) => setRhConfirmations((current) => ({ ...current, [key]: event.target.value }))} /></label><button type="button" className="btn btn--danger" style={{ marginTop: 8 }} disabled={busy || (rhConfirmations[key] ?? '').trim().toUpperCase() !== rhPreview.confirmationText} onClick={() => executeRobinhood(key)}>Confirm & place {rhPreview.side.toUpperCase()} {rhPreview.symbol}</button></div></div>
                      ) : null}
                      {rhExecutions[key] ? <div className="banner" style={{ marginTop: 10 }}><strong>Submitted to Robinhood.</strong> {rhExecutions[key].note}</div> : null}

                      {canSchwab && !schwabPreviews[key] && !schwabExecutions[key] ? <button type="button" className="btn btn--gold" disabled={busy} onClick={() => previewSchwab(index)}>Preview Schwab YMAG buy</button> : null}
                      {schwabPreview ? (
                        <div className="banner banner--intel" style={{ marginTop: 10 }}><div style={{ width: '100%' }}><strong>Live Schwab preview · BUY {schwabPreview.quantity} YMAG · est. {formatMoney(schwabPreview.estimatedTotal)}</strong><label className="field" style={{ marginTop: 8 }}><span className="field__label">Type BUY YMAG</span><input value={schwabConfirmations[key] ?? ''} onChange={(event) => setSchwabConfirmations((current) => ({ ...current, [key]: event.target.value }))} /></label><button type="button" className="btn btn--danger" style={{ marginTop: 8 }} disabled={busy || (schwabConfirmations[key] ?? '').trim().toUpperCase() !== 'BUY YMAG'} onClick={() => executeSchwab(key)}>Confirm & place BUY YMAG</button></div></div>
                      ) : null}
                      {schwabExecutions[key] ? <div className="banner" style={{ marginTop: 10 }}><strong>Submitted to Schwab.</strong> {schwabExecutions[key].note}</div> : null}
                      {validated.approved && !canRobinhood && !canSchwab ? <p className="meta">This leg can be adopted/staged, but its current broker/symbol combination still requires manual execution or a future live adapter.</p> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p className="meta">The agent recommends retaining mandate cash. No transaction was manufactured just to create activity.</p>}
          </Card>

          {result.research.available ? <details className="section"><summary className="btn btn--ghost">View Claude research brief</summary><Card label="Research Analyst" title={`Claude research · ${result.research.model ?? 'model'}`}><p style={{ whiteSpace: 'pre-wrap' }}>{result.research.text}</p></Card></details> : null}
          {result.manualSteps.length ? <Card label="Execution instructions" title="What happens after adoption"><ol className="bullets">{result.manualSteps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol></Card> : null}
        </>
      ) : null}

      {adopted ? (
        <Card label="Active strategy" title={adopted.headline} action={<Badge tone="positive">Adopted + staged</Badge>}>
          <p>{adopted.note}</p>
          {adopted.fundingInstruction ? <div className="banner banner--risk" style={{ marginTop: 10 }}><strong>Cross-broker funding step:</strong> {adopted.fundingInstruction}</div> : null}
          <div className="stack stack--tight" style={{ marginTop: 12 }}>{adopted.staged.map((leg, index) => <div key={`${index}:${leg.symbol}:${leg.side}`} className="panel"><strong>{leg.side.toUpperCase()} {leg.symbol} · {formatMoney(leg.allowedNotional)}</strong><p className="meta">{leg.broker} · {leg.executionPath.replace(/_/g, ' ')}</p><p className="meta">{leg.instruction}</p></div>)}</div>
          <div className="row" style={{ gap: 10, marginTop: 12 }}><Link className="btn btn--ghost" to="/portfolio">Open action queue</Link><Link className="btn btn--ghost" to="/activity">View audit trail</Link></div>
        </Card>
      ) : null}

      {message ? <div className="section"><div className="banner"><span className="banner__glyph">i</span><div>{message}</div></div></div> : null}
      {!result ? <Card label="Start here" title="Bring an opportunity or policy event into Modeling Lab"><p className="meta">Use Growth or Intelligence to identify a material setup, then model it here. Strategy Lab remains the broad assumptions calculator.</p><div className="row" style={{ gap: 10, marginTop: 10 }}><Link className="btn btn--ghost" to="/growth?tab=opportunities">Growth Opportunities</Link><Link className="btn btn--ghost" to="/intelligence">Market Intelligence</Link><Link className="btn btn--ghost" to="/strategy-lab">Strategy Lab</Link></div></Card> : null}
    </>
  );
}
