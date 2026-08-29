import { getDatabase } from '@netlify/database';
import type { HistoricalRelevance, IntelligenceEvent, IntelligenceEventType, IntelligenceSector } from '../../src/intelligence/types.js';

function dbAvailable(): boolean {
  try { return Boolean(getDatabase()); } catch { return false; }
}

export async function persistIntelligenceEvents(events: IntelligenceEvent[]): Promise<number> {
  if (!events.length || !dbAvailable()) return 0;
  const db = getDatabase();
  let written = 0;
  for (const event of events) {
    try {
      await db.sql`
        INSERT INTO market_intelligence_events (
          fingerprint, occurred_at, discovered_at, source, source_class,
          source_url, source_quality, sector, event_type, headline, summary,
          symbols, latency_class, direction, severity, sentiment_score, metadata,
          updated_at
        ) VALUES (
          ${event.fingerprint}, ${event.occurredAt}, ${event.discoveredAt}, ${event.source}, ${event.sourceClass},
          ${event.sourceUrl}, ${event.sourceQuality}, ${event.sector}, ${event.eventType}, ${event.headline}, ${event.summary},
          ${JSON.stringify(event.symbols)}::jsonb, ${event.latency}, ${event.direction}, ${event.severity}, ${event.sentimentScore},
          ${JSON.stringify(event.metadata ?? {})}::jsonb, NOW()
        )
        ON CONFLICT (fingerprint) DO UPDATE SET
          discovered_at = EXCLUDED.discovered_at,
          summary = EXCLUDED.summary,
          symbols = EXCLUDED.symbols,
          direction = EXCLUDED.direction,
          severity = EXCLUDED.severity,
          sentiment_score = EXCLUDED.sentiment_score,
          metadata = COALESCE(market_intelligence_events.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          updated_at = NOW()
      `;
      written += 1;
    } catch {
      // One malformed source record must never block the intelligence refresh.
    }
  }
  return written;
}

export async function recentIntelligenceEvents(limit = 80): Promise<IntelligenceEvent[]> {
  if (!dbAvailable()) return [];
  const db = getDatabase();
  try {
    const rows = await db.sql`
      SELECT fingerprint, occurred_at, discovered_at, source, source_class,
             source_url, source_quality, sector, event_type, headline, summary,
             symbols, latency_class, direction, severity, sentiment_score, metadata
      FROM market_intelligence_events
      ORDER BY occurred_at DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}
    `;
    return rows.map((row) => ({
      fingerprint: String(row.fingerprint),
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
      discoveredAt: new Date(String(row.discovered_at)).toISOString(),
      source: String(row.source),
      sourceClass: String(row.source_class) as IntelligenceEvent['sourceClass'],
      sourceUrl: row.source_url == null ? null : String(row.source_url),
      sourceQuality: Number(row.source_quality ?? 0),
      sector: String(row.sector) as IntelligenceEvent['sector'],
      eventType: String(row.event_type) as IntelligenceEvent['eventType'],
      headline: String(row.headline),
      summary: String(row.summary ?? ''),
      symbols: Array.isArray(row.symbols) ? row.symbols.map(String) : [],
      latency: String(row.latency_class) as IntelligenceEvent['latency'],
      direction: String(row.direction) as IntelligenceEvent['direction'],
      severity: String(row.severity) as IntelligenceEvent['severity'],
      sentimentScore: row.sentiment_score == null ? null : Number(row.sentiment_score),
      metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {},
    }));
  } catch {
    return [];
  }
}

export interface IntelligenceOutcome {
  referenceSymbol: string;
  baseDate: string;
  basePrice: number;
  oneDay: number | null;
  fiveDay: number | null;
  twentyDay: number | null;
  calibratedAt: string;
}

export async function updateIntelligenceOutcome(fingerprint: string, outcome: IntelligenceOutcome): Promise<boolean> {
  if (!dbAvailable()) return false;
  try {
    const db = getDatabase();
    await db.sql`
      UPDATE market_intelligence_events
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ outcome })}::jsonb,
          updated_at = NOW()
      WHERE fingerprint = ${fingerprint}
    `;
    return true;
  } catch {
    return false;
  }
}

export async function recordEventDecision(fingerprint: string, decision: Record<string, unknown>): Promise<boolean> {
  if (!dbAvailable()) return false;
  try {
    const db = getDatabase();
    await db.sql`
      UPDATE market_intelligence_events
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ actualDecision: decision })}::jsonb,
          updated_at = NOW()
      WHERE fingerprint = ${fingerprint}
    `;
    return true;
  } catch {
    return false;
  }
}

function numericOutcome(event: IntelligenceEvent, key: 'oneDay' | 'fiveDay' | 'twentyDay'): number | null {
  const outcome = event.metadata?.outcome;
  if (!outcome || typeof outcome !== 'object') return null;
  const value = (outcome as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stats(values: number[]) {
  if (!values.length) return { count: 0, median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: sorted.length, median, min: sorted[0], max: sorted.at(-1) ?? sorted[0] };
}

export async function historicalRelevanceFor(eventType: IntelligenceEventType, sector: IntelligenceSector): Promise<HistoricalRelevance> {
  const events = (await recentIntelligenceEvents(500)).filter((event) => event.eventType === eventType && (event.sector === sector || event.sector === 'cross_market'));
  const one = events.map((event) => numericOutcome(event, 'oneDay')).filter((value): value is number => value != null);
  const five = events.map((event) => numericOutcome(event, 'fiveDay')).filter((value): value is number => value != null);
  const twenty = events.map((event) => numericOutcome(event, 'twentyDay')).filter((value): value is number => value != null);
  const mature = Math.max(one.length, five.length, twenty.length);
  return {
    eventType,
    sector,
    sampleSize: events.length,
    oneDay: stats(one),
    fiveDay: stats(five),
    twentyDay: stats(twenty),
    currentRegime: null,
    summary: events.length
      ? `${events.length} comparable event${events.length === 1 ? '' : 's'} stored; ${mature} currently have at least one calibrated forward-return checkpoint.`
      : 'DAHCorp has not stored a comparable event yet. Historical relevance is unknown rather than assumed.',
  };
}
