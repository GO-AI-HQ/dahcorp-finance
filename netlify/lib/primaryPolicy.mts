import type { IntelligenceEvent, IntelligenceProviderStatus } from '../../src/intelligence/types.js';
import { classifyEvent, sectorForText, symbolsForText } from '../../src/intelligence/taxonomy.js';

interface FederalRegisterDocument {
  document_number?: string;
  title?: string;
  abstract?: string;
  publication_date?: string;
  html_url?: string;
  agencies?: Array<{ name?: string }>;
  type?: string;
}

async function fingerprint(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function federalRegister(term: string): Promise<FederalRegisterDocument[]> {
  const params = new URLSearchParams({
    per_page: '20',
    order: 'newest',
    'conditions[term]': term,
  });
  const response = await fetch(`https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return [];
  try {
    const payload = (await response.json()) as { results?: FederalRegisterDocument[] };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
}

async function normalize(document: FederalRegisterDocument): Promise<IntelligenceEvent | null> {
  const headline = document.title?.trim();
  if (!headline) return null;
  const summary = document.abstract?.trim() || '';
  const agencies = (document.agencies ?? []).map((agency) => agency.name).filter((value): value is string => Boolean(value));
  const text = `${headline} ${summary} ${agencies.join(' ')}`;
  const symbols = symbolsForText(text);
  const sector = sectorForText(text, symbols);
  const classified = classifyEvent(text, sector);
  const publicationDate = document.publication_date ?? new Date().toISOString().slice(0, 10);
  return {
    fingerprint: await fingerprint(['federal-register', document.document_number ?? '', publicationDate, headline]),
    occurredAt: `${publicationDate}T12:00:00.000Z`,
    discoveredAt: new Date().toISOString(),
    source: agencies.length ? `Federal Register · ${agencies.join(', ')}` : 'Federal Register',
    sourceClass: 'primary_source',
    sourceUrl: document.html_url?.trim() || null,
    sourceQuality: 0.98,
    sector,
    eventType: classified.eventType,
    headline,
    summary,
    symbols,
    latency: 'near_real_time',
    direction: classified.direction,
    severity: classified.severity === 'info' ? 'medium' : classified.severity,
    sentimentScore: null,
    metadata: { documentNumber: document.document_number ?? null, documentType: document.type ?? null, agencies },
  };
}

export async function fetchPrimaryPolicyIntelligence(): Promise<{
  events: IntelligenceEvent[];
  status: IntelligenceProviderStatus;
}> {
  try {
    const [semiDocs, energyDocs] = await Promise.all([
      federalRegister('semiconductor export controls CHIPS'),
      federalRegister('nuclear uranium energy FERC grid'),
    ]);
    const normalized = await Promise.all([...semiDocs, ...energyDocs].map(normalize));
    return {
      events: normalized.filter((event): event is IntelligenceEvent => event !== null),
      status: {
        provider: 'primary_sources',
        connected: true,
        status: 'live',
        note: 'Federal Register semiconductor and energy policy lanes are active. Additional BIS, EIA, DOE, FERC and NRC direct feeds can be layered onto the same normalizer.',
      },
    };
  } catch {
    return {
      events: [],
      status: {
        provider: 'primary_sources',
        connected: false,
        status: 'unavailable',
        note: 'Primary policy feed could not be refreshed. No policy event was fabricated.',
      },
    };
  }
}
