import { describe, expect, it } from 'vitest';
import { marketPulseState } from '../src/intelligence/marketPulse.js';
import { correlateGovernmentTrades } from '../src/intelligence/correlation.js';
import { translateAssetDecision } from '../src/intelligence/decisionTranslator.js';
import { classifyEvent, sectorForText } from '../src/intelligence/taxonomy.js';
import type { IntelligenceEvent, IntelligencePulse, MarketPulseTickerItem } from '../src/intelligence/types.js';

const SEMI_PULSE: IntelligencePulse = {
  sector: 'semiconductors',
  label: 'Constructive',
  score: 42,
  market: 'positive',
  policy: 'constructive',
  newsPressure: 'positive',
  capitalSignals: 'neutral',
  eventCount: 5,
  highImpactCount: 1,
};

const SEMI_MARKET: MarketPulseTickerItem = {
  sector: 'semiconductors',
  state: 'Constructive',
  benchmarks: [{ name: 'SOX', symbol: 'sox:ind', provider: 'tradingeconomics', last: 5000, return5d: 1.2, return30d: 3.2, asOf: '2026-08-29T00:00:00.000Z' }],
  confirmation: null,
  dataRole: 'primary',
  summary: 'Supportive.',
};

describe('Market Pulse normalization', () => {
  it('classifies constructive and defensive benchmark regimes', () => {
    expect(marketPulseState(1.2, 3.0)).toBe('Constructive');
    expect(marketPulseState(3.1, 4.0)).toBe('Improving');
    expect(marketPulseState(-4.2, -2.0)).toBe('Defensive');
    expect(marketPulseState(null, null)).toBe('Unavailable');
  });
});

describe('shipping analyst classification', () => {
  it('recognizes J Mintzmyer as a Shipping analyst reference through permitted downstream sources', () => {
    expect(sectorForText('J Mintzmyer discusses the outlook for maritime equities.')).toBe('shipping');
    expect(classifyEvent('J Mintzmyer discusses the outlook for maritime equities.', 'shipping').eventType).toBe('SHIPPING_ANALYST_VIEW');
  });

  it('keeps a specific freight-cycle signal ahead of the generic analyst-view tag', () => {
    expect(classifyEvent('J Mintzmyer says dry bulk is strong and the recovery is accelerating.', 'shipping').eventType).toBe('DRY_BULK_TIGHTENING');
  });
});

describe('asset Decision Translator', () => {
  it('translates a qualified core setup into BUY without making the index the trigger', () => {
    const decision = translateAssetDecision({
      symbol: 'SEMI', held: false, price: 31, trend: { status: 'TREND_CONFIRMED' }, dip: { actionable: true, declineFromReference: 0.08 },
    }, [SEMI_PULSE], [SEMI_MARKET]);
    expect(decision?.action).toBe('BUY');
    expect(decision?.modelQuestion).toContain('Model a buy decision for SEMI');
  });

  it('keeps leveraged exposure in WAIT when the semiconductor backdrop is adverse', () => {
    const decision = translateAssetDecision({
      symbol: 'SOXL', held: false, price: 20, trend: { status: 'TREND_CONFIRMED' }, dip: { actionable: true, declineFromReference: 0.2 },
    }, [{ ...SEMI_PULSE, label: 'Cautious', market: 'negative' }], [{ ...SEMI_MARKET, state: 'Weakening' }]);
    expect(decision?.action).toBe('WAIT');
  });

  it('prioritizes deterministic trend loss over a supportive sector regime', () => {
    const decision = translateAssetDecision({
      symbol: 'SEMI', held: true, price: 25, trend: { status: 'TREND_LOST' }, dip: { actionable: true, declineFromReference: 0.25 },
    }, [SEMI_PULSE], [SEMI_MARKET]);
    expect(decision?.action).toBe('REDUCE');
  });
});

describe('government trading correlation', () => {
  it('marks delayed disclosures as historical correlation against nearby policy/news', () => {
    const trade: IntelligenceEvent = {
      fingerprint: 'trade-1',
      occurredAt: '2026-06-01T12:00:00.000Z',
      discoveredAt: '2026-07-15T12:00:00.000Z',
      source: 'AInvest congressional disclosure data',
      sourceClass: 'capital_signal',
      sourceUrl: null,
      sourceQuality: 0.82,
      sector: 'energy',
      eventType: 'CAPITAL_DISCLOSURE',
      headline: 'Congressional filer disclosed a buy in CCJ',
      summary: 'Delayed disclosure.',
      symbols: ['CCJ'],
      latency: 'retrospective',
      direction: 'constructive',
      severity: 'info',
      sentimentScore: null,
      metadata: {
        politician: 'Example Filer',
        party: 'Independent',
        state: 'NC',
        tradeDate: '2026-06-01',
        filingDate: '2026-07-15',
        reportingGapDays: 44,
        tradeType: 'buy',
        size: '$1,001-$15,000',
      },
    };
    const policy: IntelligenceEvent = {
      fingerprint: 'policy-1',
      occurredAt: '2026-06-10T12:00:00.000Z',
      discoveredAt: '2026-06-10T13:00:00.000Z',
      source: 'Federal Register',
      sourceClass: 'primary_source',
      sourceUrl: null,
      sourceQuality: 1,
      sector: 'energy',
      eventType: 'NUCLEAR_POLICY',
      headline: 'New nuclear fuel policy announced',
      summary: 'Policy evidence.',
      symbols: ['CCJ'],
      latency: 'near_real_time',
      direction: 'constructive',
      severity: 'medium',
      sentimentScore: null,
    };
    const rows = correlateGovernmentTrades([trade, policy]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relation).toBe('before');
    expect(rows[0]?.daysFromEvent).toBe(9);
    expect(rows[0]?.strategicUse).toContain('never become a standalone buy or sell trigger');
  });
});
