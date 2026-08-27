import type { ReactNode } from 'react';
import { ApiError } from '../services/api.js';

export function LoadingBlock({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="stack stack--tight" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 16, width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid--4" role="status" aria-live="polite">
      <span className="sr-only">Loading figures…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card card--tight">
          <div className="skeleton" style={{ width: '55%', height: 12, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: '75%', height: 30 }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="state__title">{title}</p>
      {children ? <div className="meta">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const isAuth = error.status === 401;
  const isSetup = error.code === 'SETUP_REQUIRED';
  return (
    <div className="banner banner--risk" role="alert">
      <span className="banner__glyph" aria-hidden="true">
        ✕
      </span>
      <div>
        <span className="banner__title">
          {isSetup ? 'Setup required' : isAuth ? 'Session ended' : 'Could not load this view'}
        </span>
        <span>{error.message}</span>
        {onRetry && !isAuth ? (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn--sm btn--ghost" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
