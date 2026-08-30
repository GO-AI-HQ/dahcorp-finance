import type { IntelligenceEvent, IntelligenceProviderStatus } from '../../src/intelligence/types.js';
import { classifyEvent, sectorForText, symbolsForText } from '../../src/intelligence/taxonomy.js';

interface FeedSource {
  name: string;
  url: string;
  homepage: string;
  quality: number;
}

export interface ShippingAnalystReference {
  name: string;
  homepage: string;
  social?: string;
  automation: 'public_feed' | 'curated_reference';
  note: string;
}

/**
 * Named analyst/research lane for the Shipping engine.
 *
 * Curated references may be used for source attribution, research prompts and
 * permitted downstream news mentions, but they are not automatically scraped
 * when the source terms prohibit commercial feed use.
 */
export const SHIPPING_ANALYST_REFERENCES: ShippingAnalystReference[] = [
  {
    name: 'Vonheim / Christopher Vonheim',
    homepage: 'https://shows.acast.com/bynn-with-christopher-vonheim',
    automation: 'public_feed',
    note: 'Public podcast feed is normalized as analyst commentary and requires corroboration.',
  },
  {
    name: "What's Going on With Shipping / Sal Mercogliano",
    homepage: 'https://www.youtube.com/@wgowshipping',
    automation: 'public_feed',
    note: 'Public podcast feed is normalized as analyst commentary and requires corroboration.',
  },
  {
    name: 'J Mintzmyer',
    homepage: 'https://seekingalpha.com/author/j-mintzmyer',
    social: 'https://x.com/mintzmyer',
    automation: 'curated_reference',
    note: 'Named shipping-equities research source. Seeking Alpha author RSS is not ingested because the supplied feed limits use to personal, non-commercial purposes; permitted news mentions and manual research may still be corroborative evidence.',
  },
];

const SOURCES: FeedSource[] = [
  {
    name: 'Vonheim / Christopher Vonheim',
    url: 'https://feeds.acast.com/public/shows/5ed93d53b3f37835c31a94bf',
    homepage: 'https://shows.acast.com/bynn-with-christopher-vonheim',
    quality: 0.48,
  },
  {
    name: "What's Going on With Shipping / Sal Mercogliano",
    url: 'https://anchor.fm/s/2247e6dc/podcast/rss',
    homepage: 'https://www.youtube.com/@wgowshipping',
    quality: 0.5,
  },
];

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function field(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function linkField(item: string): string {
  const direct = field(item, 'link');
  if (/^https?:\/\//i.test(direct)) return direct;
  const href = item.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  return href && /^https?:\/\//i.test(href) ? href : '';
}

function items(xml: string): string[] {
  const rss = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (rss.length) return rss;
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
}

function occurredAt(item: string): string {
  const raw = field(item, 'pubDate') || field(item, 'published') || field(item, 'updated');
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isShippingRelevant(text: string): boolean {
  return /shipping|maritime|tanker|dry bulk|container|lng|freight|vessel|shipyard|suez|hormuz|red sea|panama canal|shadow fleet|port fee|shipbuilding/i.test(text);
}

async function normalize(source: FeedSource, raw: string): Promise<IntelligenceEvent | null> {
  const title = field(raw, 'title');
  const description = field(raw, 'description') || field(raw, 'summary') || field(raw, 'content:encoded');
  const text = `${title} ${description}`;
  if (!title || !isShippingRelevant(text)) return null;
  const date = occurredAt(raw);
  const symbols = symbolsForText(text);
  const sector = sectorForText(text, symbols);
  const classified = classifyEvent(text, sector === 'cross_market' ? 'shipping' : sector);
  const sourceUrl = linkField(raw) || source.homepage;
  return {
    fingerprint: await fingerprint(['shipping-commentary', source.name, date, title]),
    occurredAt: date,
    discoveredAt: new Date().toISOString(),
    source: source.name,
    sourceClass: 'analyst_commentary',
    sourceUrl,
    sourceQuality: source.quality,
    sector: sector === 'cross_market' ? 'shipping' : sector,
    eventType: classified.eventType === 'OTHER' ? 'SHIPPING_ANALYST_VIEW' : classified.eventType,
    headline: title,
    summary: description.slice(0, 700),
    symbols,
    latency: 'retrospective',
    direction: classified.direction,
    severity: classified.severity === 'high' ? 'medium' : classified.severity,
    sentimentScore: null,
    metadata: {
      evidenceRole: 'analyst_commentary',
      corroborationRequired: true,
      note: 'Commentary is an analyst evidence input, not a verified market fact or standalone trade trigger.',
    },
  };
}

async function fetchSource(source: FeedSource): Promise<{ events: IntelligenceEvent[]; ok: boolean }> {
  try {
    const response = await fetch(source.url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!response.ok) return { events: [], ok: false };
    const xml = await response.text();
    const normalized = await Promise.all(items(xml).slice(0, 25).map((item) => normalize(source, item)));
    return { events: normalized.filter((event): event is IntelligenceEvent => event !== null), ok: true };
  } catch {
    return { events: [], ok: false };
  }
}

export async function fetchShippingCommentary(): Promise<{ events: IntelligenceEvent[]; status: IntelligenceProviderStatus }> {
  const rows = await Promise.all(SOURCES.map(fetchSource));
  const live = rows.filter((row) => row.ok).length;
  const curated = SHIPPING_ANALYST_REFERENCES.filter((source) => source.automation === 'curated_reference').map((source) => source.name);
  return {
    events: rows.flatMap((row) => row.events),
    status: {
      provider: 'shipping_commentary',
      connected: live > 0,
      status: live === SOURCES.length ? 'live' : live ? 'partial' : 'unavailable',
      note: live
        ? `${live}/${SOURCES.length} permitted public maritime commentary feeds are active. Curated analyst references: ${curated.join(', ')}. Commentary is context only and requires corroboration by market, freight, company or policy evidence.`
        : `Public maritime commentary feeds are currently unavailable. Curated analyst references remain available for permitted/manual research: ${curated.join(', ')}; no commentary is treated as evidence until sourced through a permitted channel.`,
    },
  };
}
