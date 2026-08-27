import { clamp } from '../core/math.js';

type Tone = 'gold' | 'ice' | 'positive' | 'risk';

const CLASS: Record<Tone, string> = {
  gold: '',
  ice: 'progress--ice',
  positive: 'progress--positive',
  risk: 'progress--risk',
};

export function ProgressBar({
  label,
  value,
  valueLabel,
  tone = 'gold',
  caption,
}: {
  label: string;
  /** Fraction 0-1. Values above 1 are shown full and captioned as exceeded. */
  value: number;
  valueLabel?: string;
  tone?: Tone;
  caption?: string;
}) {
  const safe = Number.isFinite(value) ? value : 0;
  const pct = clamp(safe, 0, 1) * 100;
  return (
    <div className={`progress ${CLASS[tone]}`.trim()}>
      <div className="progress__head">
        <span>{label}</span>
        <span className="num">{valueLabel ?? `${(safe * 100).toFixed(1)}%`}</span>
      </div>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueLabel ?? `${(safe * 100).toFixed(1)}%`}
      >
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {caption ? <p className="progress__caption">{caption}</p> : null}
    </div>
  );
}
