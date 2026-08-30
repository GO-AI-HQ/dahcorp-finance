import { describe, expect, it } from 'vitest';
import {
  issueAgentJobTokenWithSecret,
  verifyAgentJobTokenWithSecret,
} from '../src/agent/jobTokenCodec.js';

const secret = 'unit-test-session-secret';
const job = {
  responseId: 'resp_abc123XYZ',
  question: 'Where should the next dollar go?',
  capital: 200,
  inputAsOf: '2026-08-30T14:42:00.000Z',
};

describe('Treasury agent job token', () => {
  it('round-trips a signed background job', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobTokenWithSecret(job, secret, now);
    const parsed = await verifyAgentJobTokenWithSecret(token, secret, now + 30_000);
    expect(parsed).toMatchObject(job);
    expect(parsed?.exp).toBeGreaterThan(parsed?.iat ?? 0);
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
