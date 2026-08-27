import type { ReactNode } from 'react';

export function KeyValue({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="kv">
      <span className="kv__key">
        {label}
        {hint ? (
          <>
            {' '}
            <span className="soft" style={{ fontSize: '0.76rem' }}>
              {hint}
            </span>
          </>
        ) : null}
      </span>
      <span className="kv__value">{children}</span>
    </div>
  );
}
