import type { DistributionEvent, IncomeEvent, PriceBar, Quote } from '../../src/core/types.js';
import { getInstrumentOrFallback } from '../../src/core/universe.js';
import type { MarketDataProvider } from '../../src/market/provider.js';
import type { IntelligenceEvent } from '../../src/intelligence/types.js';
import { intelligenceEventsByPurpose, persistIntelligenceEvents } from './intelligenceStore.mts';

const PURPOSE = 'stable_distribution_basis_v1';

type StoredDistributionSnapshot = {
  symbol: string;
  verifiedAt: string;
  events: DistributionEvent[];
  sources: string[];
};

function normalizedSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function validDistributionEvents(value: unknown): DistributionEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is DistributionEvent => Boolean(
    row
      && typeof row === 'object'
      && typeof (row as DistributionEvent).symbol === 'string'
      && typeof (row as DistributionEvent).payDate === 'string'
      && typeof (row as DistributionEvent).amountPerShare === 'number',
  ));
}

function snapshotFromEvent(event: IntelligenceEvent): StoredDistributionSnapshot | null {
  if (event.metadata?.purpose !== PURPOSE) return null;
  const symbol = typeof event.metadata.symbol === 'string' ? event.metadata.symbol.toUpperCase() : '';
  const verifiedAt = typeof event.metadata.verifiedAt === 'string' ? event.metadata.verifiedAt : event.discoveredAt;
  const events = validDistributionEvents(event.metadata.events);
  const sources = Array.isArray(event.metadata.sources) ? event.metadata.sources.map(String) : [];
  if (!symbol || !events.length || !Number.isFinite(Date.parse(verifiedAt))) return null;
  return { symbol, verifiedAt, events, sources };
}

function maxStaleDays(symbol: string): number {
  const frequency = getInstrumentOrFallback(symbol).distributionFrequency;
  if (frequency === 'weekly') return 14;
  if (frequency === 'monthly') return 45;
  if (frequency === 'quarterly') return 120;
  if (frequency === 'semiannual') return 220;
  if (frequency === 'annual') return 400;
  return 45;
}

function snapshotUsable(snapshot: StoredDistributionSnapshot): boolean {
  const ageDays = (Date.now() - Date.parse(snapshot.verifiedAt)) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= maxStaleDays(snapshot.symbol);
}

async function storedSnapshots(symbols: string[]): Promise<Map<string, StoredDistributionSnapshot>> {
  const wanted = new Set(normalizedSymbols(symbols));
  const out = new Map<string, StoredDistributionSnapshot>();
  for (const event of await intelligenceEventsByPurpose(PURPOSE, 250)) {
    const snapshot = snapshotFromEvent(event);
    if (!snapshot || !wanted.has(snapshot.symbol) || out.has(snapshot.symbol)) continue;
    out.set(snapshot.symbol, snapshot);
  }
  return out;
}

function brokerDistributions(incomeEvents: IncomeEvent[], symbols: string[]): DistributionEvent[] {
  const wanted = new Set(normalizedSymbols(symbols));
  return incomeEvents
    .filter((event) => wanted.has(event.symbol.toUpperCase()) && event.grossAmount > 0 && event.sharesAtRecord > 0)
    .map((event) => ({
      symbol: event.symbol.toUpperCase(),
      exDate: event.payDate,
      payDate: event.payDate,
      amountPerShare: event.grossAmount / event.sharesAtRecord,
      kind: 'distribution' as const,
      frequency: getInstrumentOrFallback(event.symbol).distributionFrequency,
      dataQuality: 'live' as const,
    }));
}

function mergeEvidence(providerEvents: DistributionEvent[], brokerEvents: DistributionEvent[]): DistributionEvent[] {
  const byKey = new Map<string, DistributionEvent>();
  for (const event of providerEvents) {
    byKey.set(`${event.symbol.toUpperCase()}|${event.payDate}`, event);
  }
  for (const event of brokerEvents) {
    byKey.set(`${event.symbol.toUpperCase()}|${event.payDate}`, event);
  }
  return [...byKey.values()].sort((a, b) => a.payDate.localeCompare(b.payDate));
}

async function persistSymbolSnapshot(symbol: string, events: DistributionEvent[], sources: string[]): Promise<void> {
  if (!events.length) return;
  const now = new Date().toISOString();
  const event: IntelligenceEvent = {
    fingerprint: `stable-distribution-basis-${symbol.toLowerCase()}`,
    occurredAt: now,
    discoveredAt: now,
    source: 'DAHCorp verified distribution basis',
    sourceClass: 'market_benchmark',
    sourceUrl: null,
    sourceQuality: 0.94,
    sector: 'cross_market',
    eventType: 'OTHER',
    headline: `${symbol} distribution basis verified`,
    summary: `${events.length} verified distribution record${events.length === 1 ? '' : 's'} retained so a temporary provider miss cannot erase income planning.`,
    symbols: [symbol],
    latency: 'near_real_time',
    direction: 'neutral',
    severity: 'info',
    sentimentScore: null,
    metadata: {
      purpose: PURPOSE,
      symbol,
      verifiedAt: now,
      sources: [...new Set(sources)],
      events,
      rule: 'Broker-realized income may verify held-position cash payments. FMP remains preferred for declared distribution history, with OpenBB as fallback. A retained snapshot is marked stale and is never execution pricing.',
    },
  };
  await persistIntelligenceEvents([event]);
}

/**
 * Persist freshly verified distribution rows from scheduled/background work.
 * Interactive portfolio requests intentionally do not write these snapshots;
 * that keeps page loads bounded while preserving the last-good evidence model.
 */
export async function persistStableDistributionEvidence(
  events: DistributionEvent[],
  sourceLabel = 'scheduled verified distribution refresh',
): Promise<void> {
  const symbols = normalizedSymbols(events.map((event) => event.symbol));
  for (const symbol of symbols) {
    const rows = events.filter((event) => event.symbol.toUpperCase() === symbol);
    if (!rows.length) continue;
    await persistSymbolSnapshot(symbol, rows, [sourceLabel]);
  }
}

/**
 * Server-only stability wrapper for income evidence.
 *
 * Ownership/share count remains brokerage authoritative. Distribution history
 * comes from the configured provider stack (FMP preferred, OpenBB fallback),
 * may be reconciled with actual broker income events, and can fall back to the
 * last verified basis. Interactive reads never persist snapshots synchronously.
 */
export class StableDistributionMarketDataProvider implements MarketDataProvider {
  readonly id: string;
  readonly isMock: boolean;
  readonly sourceNotes: string[];

  constructor(private readonly base: MarketDataProvider, private readonly incomeEvents: IncomeEvent[] = []) {
    this.id = `${base.id}+stable-distributions`;
    this.isMock = base.isMock;
    this.sourceNotes = [
      ...(base.sourceNotes ?? []),
      'Held-position share counts come from the connected broker. Distribution history uses FMP first and OpenBB as fallback, then may reuse the last verified per-symbol basis across temporary provider misses.',
      'Broker-reported income can verify actual cash received. Retained distribution evidence is planning data only and is never treated as fresh execution pricing.',
    ];
  }

  getQuotes(symbols: string[], asOf: string): Promise<Record<string, Quote>> {
    return this.base.getQuotes(symbols, asOf);
  }

  getPriceHistory(symbols: string[], asOf: string, days: number): Promise<Record<string, PriceBar[]>> {
    return this.base.getPriceHistory(symbols, asOf, days);
  }

  async getDistributions(symbols: string[], asOf: string, days: number): Promise<DistributionEvent[]> {
    const wanted = normalizedSymbols(symbols);
    const brokerRows = brokerDistributions(this.incomeEvents, wanted);

    // Run the live-provider request and retained-evidence read concurrently so
    // the database lookup does not add a second serial wait to every page load.
    const [providerRows, stored] = await Promise.all([
      this.base.getDistributions(wanted, asOf, days).catch(() => [] as DistributionEvent[]),
      storedSnapshots(wanted).catch(() => new Map<string, StoredDistributionSnapshot>()),
    ]);

    const out: DistributionEvent[] = [];
    for (const symbol of wanted) {
      const providerForSymbol = providerRows.filter((row) => row.symbol.toUpperCase() === symbol);
      const brokerForSymbol = brokerRows.filter((row) => row.symbol.toUpperCase() === symbol);
      const current = mergeEvidence(providerForSymbol, brokerForSymbol);

      if (current.length) {
        out.push(...current);
        continue;
      }

      const previous = stored.get(symbol);
      if (previous && snapshotUsable(previous)) {
        out.push(...previous.events.map((row) => ({ ...row, dataQuality: 'stale' as const })));
      }
    }

    return out.sort((a, b) => a.payDate.localeCompare(b.payDate));
  }
}
