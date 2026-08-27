import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge.js';

/**
 * A top-level figure. The delta always carries a text sign as well as a colour,
 * and the caption is where the honesty lives — "modeled", "received", "mock".
 */
export function StatCard({
  label,
  value,
  caption,
  delta,
  deltaDirection,
  tone = 'default',
  badge,
  footer,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  delta?: string;
  deltaDirection?: 'up' | 'down' | 'flat';
  tone?: 'default' | 'gold' | 'ice';
  badge?: { text: string; tone: BadgeTone; glyph?: string };
  footer?: ReactNode;
}) {
  const figureClass = tone === 'gold' ? 'figure figure--gold' : tone === 'ice' ? 'figure figure--ice' : 'figure';
  const arrow = deltaDirection === 'up' ? '▲' : deltaDirection === 'down' ? '▼' : '■';

  return (
    <div className="card card--tight">
      <p className="card__label">
        <span>{label}</span>
        {badge ? (
          <Badge tone={badge.tone} glyph={badge.glyph}>
            {badge.text}
          </Badge>
        ) : null}
      </p>
      <p className={figureClass}>{value}</p>
      {delta ? (
        <p className={`delta delta--${deltaDirection ?? 'flat'}`}>
          <span aria-hidden="true">{arrow}</span>
          <span>{delta}</span>
        </p>
      ) : null}
      {caption ? <p className="meta" style={{ marginTop: 6 }}>{caption}</p> : null}
      {footer}
    </div>
  );
}
