import { getDatabase } from '@netlify/database';
import type { IntelligenceEvent } from '../../src/intelligence/types.js';

function dbAvailable(): boolean {
  try {
    return Boolean(getDatabase());
  } catch {
    return false;
  }
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
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;
      written += 1;
    } catch {
      // A malformed or unavailable source record must never block the rest of
      // the intelligence refresh. No provider body or secret is logged here.
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
      LIMIT ${Math.min(Math.max(limit, 1), 200)}
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
