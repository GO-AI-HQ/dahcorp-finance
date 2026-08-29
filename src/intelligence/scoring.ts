import type { IntelligenceEvent, IntelligencePulse, IntelligenceSector } from './types.js';

function ageHours(asOf: Date, value: string): number {
  const ms = asOf.getTime() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : 9999;
}

function recencyWeight(hours: number): number {
  if (hours <= 6) return 1;
  if (hours <= 24) return 0.8;
  if (hours <= 72) return 0.55;
  if (hours <= 168) return 0.3;
  return 0.12;
}

function severityWeight(event: IntelligenceEvent): number {
  return event.severity === 'high' ? 1 : event.severity === 'medium' ? 0.65 : event.severity === 'low' ? 0.35 : 0.18;
}

function signedDirection(event: IntelligenceEvent): number {
  if (event.direction === 'constructive') return 1;
  if (event.direction === 'restrictive') return -1;
  return 0;
}

function classifyDirection(value: number): 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown' {
  if (!Number.isFinite(value)) return 'unknown';
  if (value >= 0.2) return 'positive';
  if (value <= -0.2) return 'negative';
  return 'neutral';
}

function policyLabel(events: IntelligenceEvent[]): IntelligencePulse['policy'] {
  const policy = events.filter((event) => event.sourceClass === 'primary_source' || event.sourceClass === 'policy_proxy');
  if (!policy.length) return 'unknown';
  const positive = policy.filter((event) => event.direction === 'constructive').length;
  const negative = policy.filter((event) => event.direction === 'restrictive').length;
  if (positive && negative) return 'mixed';
  if (positive) return 'constructive';
  if (negative) return 'restrictive';
  return 'neutral';
}

function capitalLabel(events: IntelligenceEvent[]): IntelligencePulse['capitalSignals'] {
  const signals = events.filter((event) => event.sourceClass === 'capital_signal');
  if (!signals.length) return 'unknown';
  const positive = signals.filter((event) => event.direction === 'constructive').length;
  const negative = signals.filter((event) => event.direction === 'restrictive').length;
  if (positive && negative) return 'mixed';
  if (negative) return 'cautious';
  if (positive) return 'constructive';
  return 'neutral';
}

export function buildIntelligencePulse(
  sector: Exclude<IntelligenceSector, 'cross_market'>,
  events: IntelligenceEvent[],
  asOf = new Date(),
): IntelligencePulse {
  const relevant = events.filter((event) => event.sector === sector || event.sector === 'cross_market');
  let numerator = 0;
  let denominator = 0;
  for (const event of relevant) {
    const weight = recencyWeight(ageHours(asOf, event.occurredAt)) * severityWeight(event) * Math.max(0.25, event.sourceQuality);
    numerator += signedDirection(event) * weight;
    denominator += weight;
  }
  const normalized = denominator ? numerator / denominator : 0;
  const score = Math.round(Math.max(-100, Math.min(100, normalized * 100)));
  const label: IntelligencePulse['label'] =
    score >= 20 ? 'Constructive' : score <= -25 ? 'Cautious' : relevant.some((event) => event.severity === 'high') ? 'Watching' : 'Neutral';

  const news = relevant.filter((event) => event.sourceClass === 'market_news' || event.sourceClass === 'corporate');
  const newsValue = news.length
    ? news.reduce((sum, event) => sum + (event.sentimentScore ?? signedDirection(event)), 0) / news.length
    : Number.NaN;

  return {
    sector,
    label,
    score,
    market: classifyDirection(normalized),
    policy: policyLabel(relevant),
    newsPressure: classifyDirection(newsValue),
    capitalSignals: capitalLabel(relevant),
    eventCount: relevant.length,
    highImpactCount: relevant.filter((event) => event.severity === 'high').length,
  };
}
