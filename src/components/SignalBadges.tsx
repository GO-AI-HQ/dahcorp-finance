import { Badge, type BadgeTone } from './Badge.js';
import type { DipSignal, TrendSignal } from '../core/signals.js';
import type { RiskFinding } from '../risk/types.js';

const TREND: Record<TrendSignal['status'], { tone: BadgeTone; glyph: string; label: string }> = {
  TREND_CONFIRMED: { tone: 'positive', glyph: '▲', label: 'Trend confirmed' },
  TREND_WEAKENING: { tone: 'warning', glyph: '▲', label: 'Trend weakening' },
  TREND_LOST: { tone: 'negative', glyph: '▼', label: 'Trend lost' },
  INSUFFICIENT_DATA: { tone: 'neutral', glyph: '?', label: 'Insufficient data' },
};

/** Deterministic trend status. Claude never sets this — code computes it. */
export function TrendBadge({ trend, compact = false }: { trend: TrendSignal; compact?: boolean }) {
  const spec = TREND[trend.status];
  return (
    <Badge tone={spec.tone} glyph={spec.glyph} title={trend.summary}>
      {compact ? spec.label.replace('Trend ', '') : spec.label}
      {trend.evaluable > 0 ? (
        <span className="soft" style={{ marginLeft: 6 }}>
          {trend.passed}/{trend.evaluable}
        </span>
      ) : null}
    </Badge>
  );
}

export function DipBadge({ dip }: { dip: DipSignal }) {
  if (dip.levelReached == null) {
    return (
      <Badge tone="neutral" glyph="—" title={dip.rationale.join(' ')}>
        No dip level met
      </Badge>
    );
  }
  return (
    <Badge
      tone={dip.actionable ? 'ice' : 'warning'}
      glyph={dip.actionable ? '↓' : '▲'}
      title={dip.rationale.join(' ')}
    >
      {(dip.levelReached * 100).toFixed(0)}% dip {dip.actionable ? 'actionable' : 'not actionable'}
    </Badge>
  );
}

const VERDICT: Record<string, { tone: BadgeTone; glyph: string; label: string }> = {
  consider_adding: { tone: 'positive', glyph: '+', label: 'Consider adding' },
  maintain: { tone: 'ice', glyph: '=', label: 'Maintain' },
  avoid: { tone: 'negative', glyph: '✕', label: 'Avoid' },
  insufficient_data: { tone: 'neutral', glyph: '?', label: 'Insufficient data' },
};

export function VerdictBadge({ verdict, title }: { verdict: string; title?: string }) {
  const spec = VERDICT[verdict] ?? VERDICT.insufficient_data;
  return (
    <Badge tone={spec.tone} glyph={spec.glyph} title={title}>
      {spec.label}
    </Badge>
  );
}

const SEVERITY: Record<string, { tone: BadgeTone; glyph: string }> = {
  high: { tone: 'negative', glyph: '!' },
  medium: { tone: 'warning', glyph: '▲' },
  low: { tone: 'neutral', glyph: '·' },
  block: { tone: 'negative', glyph: '✕' },
  warning: { tone: 'warning', glyph: '▲' },
  info: { tone: 'ice', glyph: 'i' },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const spec = SEVERITY[severity] ?? SEVERITY.low;
  return (
    <Badge tone={spec.tone} glyph={spec.glyph}>
      {severity}
    </Badge>
  );
}

/** Risk-engine findings. The engine's verdict is the authority, so it is shown verbatim. */
export function RiskFindingList({ findings }: { findings: RiskFinding[] }) {
  if (!findings.length) return <p className="meta">No findings.</p>;
  return (
    <ul className="list-reset stack stack--tight">
      {findings.map((finding, i) => (
        <li key={`${finding.code}-${i}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <SeverityBadge severity={finding.severity} />
          <span style={{ flex: 1 }}>
            {finding.message}
            {finding.limit != null && finding.actual != null ? (
              <span className="soft"> (limit {finding.limit}, actual {finding.actual})</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
