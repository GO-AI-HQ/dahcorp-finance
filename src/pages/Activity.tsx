import { api } from '../services/api.js';
import { useResource } from '../hooks/useResource.js';
import { PageHead } from '../components/PageHead.js';
import { Card } from '../components/Card.js';
import { Badge, type BadgeTone } from '../components/Badge.js';
import { KeyValue } from '../components/KeyValue.js';
import { EmptyState, ErrorState, LoadingBlock } from '../components/States.js';
import { SeverityBadge } from '../components/SignalBadges.js';
import { formatMoney } from '../core/format.js';

const ACTION_TONE: Record<string, { tone: BadgeTone; glyph: string }> = {
  approved: { tone: 'positive', glyph: '✓' },
  rejected: { tone: 'negative', glyph: '✕' },
  edited: { tone: 'warning', glyph: '✎' },
  pending: { tone: 'neutral', glyph: '·' },
};

function timestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function Activity() {
  const activity = useResource(() => api.activity(100), []);

  if (activity.error) return <ErrorState error={activity.error} onRetry={activity.reload} />;
  if (!activity.data) return <LoadingBlock rows={6} label="Loading audit trail" />;

  const d = activity.data;

  return (
    <>
      <PageHead
        eyebrow="Activity"
        title="Audit trail"
        lede="Every recommendation, decision, preview and policy change is recorded append-only, with the snapshot it was based on. An unauditable recommendation is worse than none."
        action={
          <Badge tone={d.databaseAttached ? 'positive' : 'warning'} glyph={d.databaseAttached ? '✓' : '▲'}>
            {d.databaseAttached ? 'Persistent store attached' : 'No database attached'}
          </Badge>
        }
      />

      {d.note ? (
        <div className="banner banner--mock" role="note">
          <span className="banner__glyph" aria-hidden="true">
            ▲
          </span>
          <div>
            <span className="banner__title">History is not being persisted</span>
            <span>{d.note}</span>
          </div>
        </div>
      ) : null}

      <div className="section">
        <Card label="Recommendations" title="What was proposed, and what was decided">
          {d.recommendations.length === 0 ? (
            <EmptyState title="No recommendations recorded yet">
              Ask the strategist a question on the Claude page and the brief will be archived here.
            </EmptyState>
          ) : (
            <div className="stack">
              {d.recommendations.map((rec) => {
                const action = ACTION_TONE[rec.userAction] ?? ACTION_TONE.pending;
                return (
                  <div key={rec.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--space-4)' }}>
                    <div className="row row--between">
                      <strong>{rec.headline}</strong>
                      <div className="row" style={{ gap: 8 }}>
                        <Badge tone={rec.source === 'claude' ? 'intel' : 'neutral'} glyph={rec.source === 'claude' ? '◆' : '⚙'}>
                          {rec.source}
                          {rec.model ? ` · ${rec.model}` : ''}
                        </Badge>
                        <Badge tone={action.tone} glyph={action.glyph}>
                          {rec.userAction}
                        </Badge>
                      </div>
                    </div>
                    <p className="meta">
                      {timestamp(rec.createdAt)} · asked “{rec.question}” with {formatMoney(rec.availableCapital, 0)}{' '}
                      available · {rec.confidence} confidence
                      {rec.actedAt ? ` · decided ${timestamp(rec.actedAt)}` : ''}
                    </p>
                    <p>{rec.brief.thesis}</p>
                    {rec.brief.legs.length ? (
                      <ul className="bullets">
                        {rec.brief.legs.map((leg, i) => (
                          <li key={`${rec.id}-${leg.symbol}-${i}`}>
                            {formatMoney(leg.amount, 0)} → {leg.symbol} ({leg.accountId}): {leg.reason}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {rec.userNote ? <p className="meta">Note: {rec.userNote}</p> : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card
          label="Trade previews"
          title="Validated, never placed"
          hint="Status is only ever 'preview' or 'rejected' in this build. Nothing reaches a broker."
        >
          {d.orderPreviews.length === 0 ? (
            <EmptyState title="No previews recorded">
              Previews appear here once a recommendation is validated against the risk engine.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Order</th>
                    <th scope="col">Account</th>
                    <th scope="col">Requested</th>
                    <th scope="col">Allowed</th>
                    <th scope="col">Risk</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.orderPreviews.map((preview) => (
                    <tr key={preview.id}>
                      <td>{timestamp(preview.createdAt)}</td>
                      <th scope="row">
                        {preview.side} {preview.symbol}
                        <span className="soft" style={{ display: 'block', fontSize: '0.76rem' }}>
                          {preview.origin}
                        </span>
                      </th>
                      <td>
                        {preview.accountExternalId}
                        <span className="soft"> ({preview.broker})</span>
                      </td>
                      <td className="num">
                        {preview.notional != null ? formatMoney(preview.notional, 0) : `${preview.quantity ?? 0} sh`}
                      </td>
                      <td className="num">{formatMoney(preview.allowedNotional, 0)}</td>
                      <td>
                        <Badge tone={preview.approvedByRisk ? 'positive' : 'negative'} glyph={preview.approvedByRisk ? '✓' : '✕'}>
                          {preview.approvedByRisk ? 'Approved' : 'Rejected'}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone="neutral" glyph="·">
                          {preview.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card label="Event log" title="Append-only system log">
          {d.events.length === 0 ? (
            <EmptyState title="No events recorded">
              Sign-ins, policy changes, analyses and preview validations are logged here.
            </EmptyState>
          ) : (
            <div className="stack stack--tight">
              {d.events.map((event) => (
                <div key={event.id} className="kv">
                  <span className="kv__key">
                    <SeverityBadge severity={event.severity} />{' '}
                    <span className="soft">{timestamp(event.createdAt)}</span>
                  </span>
                  <span className="kv__value">
                    <strong>
                      {event.category}/{event.action}
                    </strong>{' '}
                    — {event.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="section">
        <Card label="Retention" title="What is and is not stored">
          <div className="stack stack--tight">
            <KeyValue label="Stored">
              Accounts, holdings, distributions received, contributions, corporate actions, recommendations with their
              snapshots, risk outcomes, previews and audit events.
            </KeyValue>
            <KeyValue label="Never stored">
              Broker credentials, OAuth tokens, API keys, session tokens. Quotes and prices are fetched per request rather
              than persisted, so a stale price can never masquerade as current.
            </KeyValue>
          </div>
        </Card>
      </div>
    </>
  );
}
