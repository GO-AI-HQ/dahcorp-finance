import { describe, expect, it } from 'vitest';
import { issueAgentJobToken, verifyAgentJobToken } from '../netlify/lib/agentJobToken.mts';

const env = {
  DAHCORP_SESSION_SECRET: 'unit-test-session-secret',
} as NodeJS.ProcessEnv;

const job = {
  responseId: 'resp_abc123XYZ',
  question: 'Where should the next dollar go?',
  capital: 200,
  inputAsOf: '2026-08-30T14:42:00.000Z',
};

describe('Treasury agent job token', () => {
  it('round-trips a signed background job', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobToken(job, env, now);
    const parsed = await verifyAgentJobToken(token, env, now + 30_000);
    expect(parsed).toMatchObject(job);
    expect(parsed?.exp).toBeGreaterThan(parsed?.iat ?? 0);
  });

  it('rejects tampering', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobToken(job, env, now);
    const [body, signature] = token.split('.');
    const tampered = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${signature}`;
    expect(await verifyAgentJobToken(tampered, env, now + 30_000)).toBeNull();
  });

  it('expires background jobs', async () => {
    const now = Date.UTC(2026, 7, 30, 14, 42, 0);
    const token = await issueAgentJobToken(job, env, now);
    expect(await verifyAgentJobToken(token, env, now + 16 * 60_000)).toBeNull();
  });
});
