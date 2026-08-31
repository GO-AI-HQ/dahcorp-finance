import { describe, expect, it } from 'vitest';
import {
  issueAgentJobTokenWithSecret,
  verifyAgentJobTokenWithSecret,
} from '../src/agent/jobTokenCodec.js';
import type { ModelDataProvenance } from '../src/agent/provenance.js';

const secret = 'unit-test-session-secret';
const job = {
  responseId: 'resp_abc123XYZ',
  question: 'Where should the next dollar go?',
  capital: 200,
  inputAsOf: '2026-08-30T14:42:00.000Z',
};

const provenance: ModelDataProvenance = {
  schemaVersion: 1,
  generatedAt: '2026-08-30T14:42:00.000Z',
  preparation: { readMode: 'prepared_snapshot', providerCallsDuringPreparation: 'none' },
  portfolio: {
    asOf: '2026-08-30',
    preparedAt: '2026-08-30T14:40:00.000Z',
    freshness: 'fresh',
    dataQuality: 'delayed',
    containsMockData: false,
    marketReadMode: 'prepared_market',
  },
  market: {
    source: 'prepared_market_snapshot',
    builtAt: '2026-08-30T14:37:00.000Z',
    freshness: 'fresh',
    quoteSymbolCount: 12,
    historySymbolCount: 12,
    distributionSymbolCount: 4,
    retainedEvidenceCount: 0,
  },
  intelligence: {
    source: 'prepared_intelligence_snapshot',
    builtAt: '2026-08-30T14:17:00.000Z',
    freshness: 'fresh',
    coveragePct: 75,
    liveLaneCount: 5,
    partialLaneCount: 2,
    unavailableLaneCount: 1,
    expandedFinnhubCompanyCount: 20,
  },
  constraints: ['Planning evidence is not execution state.'],
};

describe('Treasury agent job token', () => {
  it('round-trips a signed background job', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobTokenWithSecret(job, secret, now);
    const parsed = await verifyAgentJobTokenWithSecret(token, secret, now + 30_000);
    expect(parsed).toMatchObject(job);
    expect(parsed?.exp).toBeGreaterThan(parsed?.iat ?? 0);
  });

  it('preserves the original safe model provenance and exact-input fingerprint', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const enriched = {
      ...job,
      modelInputFingerprint: 'a'.repeat(64),
      modelDataProvenance: provenance,
    };
    const token = await issueAgentJobTokenWithSecret(enriched, secret, now);
    const parsed = await verifyAgentJobTokenWithSecret(token, secret, now + 30_000);
    expect(parsed?.modelInputFingerprint).toBe('a'.repeat(64));
    expect(parsed?.modelDataProvenance).toEqual(provenance);
  });

  it('rejects tampering', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobTokenWithSecret(job, secret, now);
    const [body, signature] = token.split('.');
    const tampered = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${signature}`;
    expect(await verifyAgentJobTokenWithSecret(tampered, secret, now + 30_000)).toBeNull();
  });

  it('expires background jobs', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobTokenWithSecret(job, secret, now);
    expect(await verifyAgentJobTokenWithSecret(token, secret, now + 16 * 60_000)).toBeNull();
  });
});
