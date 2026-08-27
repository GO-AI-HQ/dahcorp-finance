import type { ReactNode } from 'react';
import type { TooltipContentProps } from 'recharts';

interface TooltipOptions {
  /** Values arrive pre-formatted so a chart never invents its own formatting. */
  format: (value: number, name: string) => string;
  labelFormat?: (label: string) => string;
}

/**
 * One tooltip for every chart. Used as `content={chartTooltip({...})}` so
 * Recharts supplies the payload props rather than the call site.
 */
export function chartTooltip({ format, labelFormat }: TooltipOptions) {
  return function Tip({ active, payload, label }: TooltipContentProps): ReactNode {
    if (!active || !payload?.length) return null;
    const raw = typeof label === 'string' || typeof label === 'number' ? String(label) : '';
    const heading = labelFormat ? labelFormat(raw) : raw;

    return (
      <div className="chart-tooltip">
        {heading ? <p className="chart-tooltip__label">{heading}</p> : null}
        {payload.map((entry, index) => (
          <p key={`${String(entry.name ?? index)}`}>
            <span style={{ color: entry.color }} aria-hidden="true">
              ●{' '}
            </span>
            {String(entry.name ?? '')}:{' '}
            <span className="num">{format(Number(entry.value ?? 0), String(entry.name ?? ''))}</span>
          </p>
        ))}
      </div>
    );
  };
}
