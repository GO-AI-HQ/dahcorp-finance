import type { GovernmentTradingSignal, IntelligenceEvent, IntelligenceSector } from './types.js';

function toDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  // AInvest reports trade/filing dates without a time. Normalize those dates to
  // noon UTC, matching the AInvest adapter, so correlation windows do not gain
  // or lose a day simply because another source includes an intraday timestamp.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T12:00:00.000Z`;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function metadataString(event: IntelligenceEvent, key: string): string | null {
  const value = event.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(event: IntelligenceEvent, key: string): number | null {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tradeSector(event: IntelligenceEvent): Exclude<IntelligenceSector, 'cross_market'> | null {
  return event.sector === 'cross_market' ? null : event.sector;
}

function candidateEvents(trade: IntelligenceEvent, events: IntelligenceEvent[]): IntelligenceEvent[] {
  const sector = tradeSector(trade);
  if (!sector) return [];
  return events.filter((event) => {
    if (event.fingerprint === trade.fingerprint || event.sourceClass === 'capital_signal') return false;
    if (!(event.sector === sector || event.sector === 'cross_market')) return false;
    return event.sourceClass === 'primary_source'
      || event.sourceClass === 'policy_proxy'
      || event.sourceClass === 'market_news'
      || event.sourceClass === 'corporate'
      || event.sourceClass === 'supply_chain';
  });
}

function nearestEvent(tradeDate: string, events: IntelligenceEvent[]): { event: IntelligenceEvent; signedDays: number; distance: number } | null {
  const tradeTime = new Date(tradeDate).getTime();
  if (!Number.isFinite(tradeTime)) return null;
  let best: { event: IntelligenceEvent; signedDays: number; distance: number } | null = null;
  for (const event of events) {
    const eventTime = new Date(event.occurredAt).getTime();
    if (!Number.isFinite(eventTime)) continue;
    const signedDays = Math.round((eventTime - tradeTime) / 86_400_000);
    const distance = Math.abs(signedDays);
    if (distance > 60) continue;
    if (!best || distance < best.distance || (distance === best.distance && event.sourceClass === 'primary_source')) {
      best = { event, signedDays, distance };
    }
  }
  return best;
}

function relationFor(signedDays: number): GovernmentTradingSignal['relation'] {
  if (Math.abs(signedDays) <= 3) return 'near';
  return signedDays > 0 ? 'before' : 'after';
}

export function correlateGovernmentTrades(events: IntelligenceEvent[]): GovernmentTradingSignal[] {
  const trades = events.filter((event) => event.sourceClass === 'capital_signal' && event.eventType === 'CAPITAL_DISCLOSURE');
  const rows: GovernmentTradingSignal[] = [];

  for (const trade of trades) {
    const sector = tradeSector(trade);
    const symbol = trade.symbols[0] ?? '';
    if (!sector || !symbol) continue;
    const tradeDate = toDate(metadataString(trade, 'tradeDate') ?? trade.occurredAt);
    const filingDate = toDate(metadataString(trade, 'filingDate') ?? trade.discoveredAt);
    const related = tradeDate ? nearestEvent(tradeDate, candidateEvents(trade, events)) : null;
    const relation = related ? relationFor(related.signedDays) : 'none';
    const days = related?.distance ?? null;
    const side = metadataString(trade, 'tradeType')?.toLowerCase();
    const tradeType: GovernmentTradingSignal['tradeType'] = side === 'buy' ? 'buy' : side === 'sell' ? 'sell' : 'other';
    const gap = metadataNumber(trade, 'reportingGapDays');

    const correlation = related
      ? relation === 'near'
        ? `Transaction occurred within ${days} day${days === 1 ? '' : 's'} of a relevant ${related.event.sourceClass === 'primary_source' ? 'policy' : 'news'} event.`
        : `Transaction occurred ${days} day${days === 1 ? '' : 's'} ${relation} a relevant ${related.event.sourceClass === 'primary_source' ? 'policy' : 'news'} event.`
      : 'No material same-sector policy/news event was found within the ±60-day study window.';

    rows.push({
      fingerprint: trade.fingerprint,
      sector,
      symbol,
      trader: metadataString(trade, 'politician') ?? 'Congressional filer',
      party: metadataString(trade, 'party'),
      state: metadataString(trade, 'state'),
      tradeType,
      tradeDate,
      filingDate,
      reportingGapDays: gap,
      size: metadataString(trade, 'size'),
      relatedEventFingerprint: related?.event.fingerprint ?? null,
      relatedHeadline: related?.event.headline ?? null,
      relatedSource: related?.event.source ?? null,
      relation,
      daysFromEvent: days,
      correlation,
      strategicUse: 'Historical correlation only — public disclosures are delayed and never become a standalone buy or sell trigger.',
    });
  }

  return rows.sort((a, b) => new Date(b.filingDate ?? b.tradeDate ?? 0).getTime() - new Date(a.filingDate ?? a.tradeDate ?? 0).getTime());
}
