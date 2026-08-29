import { agenticApi } from '../services/agenticApi.js';
import { useResource } from '../hooks/useResource.js';
import { Card } from './Card.js';
import { Badge } from './Badge.js';
import { ProgressBar } from './ProgressBar.js';
import { formatMoney } from '../core/format.js';

function actionTone(action: string) {
  if (action === 'buy') return 'positive' as const;
  if (action === 'harvest') return 'gold' as const;
  if (action === 'reduce' || action === 'exit') return 'negative' as const;
  if (action === 'reserve') return 'ice' as const;
  return 'neutral' as const;
}

export function AgenticReadinessCard() {
  const resource = useResource(() => agenticApi.readiness(), []);

  if (resource.error) {
    return (
      <Card label="Agentic evidence" title="Readiness unavailable" tone="risk">
        <p className="meta">{resource.error.message}</p>
        <button className="btn btn--sm" type="button" onClick={resource.reload} style={{ marginTop: 10 }}>Retry</button>
      </Card>
    );
  }
  if (!resource.data) {
    return <Card label="Agentic evidence" title="Building the evidence map" tone="intel"><p className="soft">Reading live strategy coverage and the Shadow ledger…</p></Card>;
  }

  const data = resource.data;
  return (
    <Card
      label="Agentic evidence"
      title={`${data.stage} · ${data.overall}%`}
      tone="intel"
      action={
        <div className="row" style={{ gap: 8 }}>
          <Badge tone="ice" glyph="◌">{data.mode === 'shadow' ? 'Shadow Mode' : data.mode}</Badge>
          <Badge tone={data.cashQueue.availableCash > 0 ? 'positive' : 'neutral'} glyph="$">{formatMoney(data.cashQueue.availableCash)} queued</Badge>
        </div>
      }
      hint={data.explanation}
    >
      <ProgressBar
        label="Evidence maturity"
        value={data.overall / 100}
        valueLabel={`${data.overall}%`}
        tone="ice"
        caption="This bar advances as the system accumulates distinct market days, auditable Shadow observations, outcome checks and external intelligence coverage. It is not a model-training percentage."
      />

      <div className="grid grid--2" style={{ marginTop: 18, gap: 18 }}>
        <div className="stack stack--tight">
          {data.dimensions.map((dimension) => (
            <ProgressBar
              key={dimension.key}
              label={dimension.label}
              value={dimension.progress}
              valueLabel={`${Math.round(dimension.progress * 100)}%`}
              tone={dimension.progress >= 0.8 ? 'positive' : dimension.progress > 0 ? 'gold' : 'ice'}
              caption={dimension.detail}
            />
          ))}
        </div>

        <div>
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <div>
              <p className="card__label"><span>What the engine saw</span></p>
              <p className="meta">Latest auditable Shadow decisions</p>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {data.allowlist.map((symbol) => <Badge key={symbol} tone="neutral">{symbol}</Badge>)}
            </div>
          </div>

          {data.evidence.latest.length === 0 ? (
            <div className="banner">
              <span className="banner__glyph">◌</span>
              <div>
                <strong className="banner__title">Observation window just opened</strong>
                The weekday Shadow job has not recorded its first post-close evidence set yet. The strategy remains unable to trade in Shadow Mode.
              </div>
            </div>
          ) : (
            <div className="stack stack--tight">
              {data.evidence.latest.slice(0, 6).map((observation) => (
                <div key={observation.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <div className="row row--between" style={{ gap: 10 }}>
                    <strong>{observation.symbol} · {observation.marketDate}</strong>
                    <div className="row" style={{ gap: 6 }}>
                      <Badge tone={actionTone(observation.action)}>{observation.action.toUpperCase()}</Badge>
                      <Badge tone="neutral">Evidence {Math.round(observation.score)}/100</Badge>
                    </div>
                  </div>
                  <p className="meta" style={{ marginTop: 5 }}>{observation.rationale}</p>
                  {observation.suggestedNotional > 0 ? (
                    <p className="meta" style={{ marginTop: 4 }}>Shadow allocation: {formatMoney(observation.suggestedNotional)} · no order submitted.</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
