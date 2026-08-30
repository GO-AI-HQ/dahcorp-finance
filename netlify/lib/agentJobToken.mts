import {
  issueAgentJobTokenWithSecret,
  verifyAgentJobTokenWithSecret,
  type TreasuryAgentJob,
} from '../../src/agent/jobTokenCodec.js';

export type { TreasuryAgentJob } from '../../src/agent/jobTokenCodec.js';

export type TreasuryJobEnv = Record<string, string | undefined>;

function envValue(key: string, env?: TreasuryJobEnv): string | undefined {
  if (env) return env[key];
  try {
    const netlify = (globalThis as typeof globalThis & {
      Netlify?: { env?: { get?: (name: string) => string | undefined } };
    }).Netlify;
    const value = netlify?.env?.get?.(key);
    if (value != null) return value;
  } catch {
    // Local/unit-test runtimes may not expose the Netlify global.
  }
  return process.env[key];
}

function signingMaterial(env?: TreasuryJobEnv): string {
  const sessionSecret = envValue('DAHCORP_SESSION_SECRET', env)?.trim();
  const passcode = envValue('DAHCORP_ACCESS_PASSCODE', env)?.trim();
  const material = sessionSecret || (passcode ? `derived:${passcode}` : null);
  if (!material) throw new Error('No DAHCorp signing material is configured.');
  return material;
}

export async function issueAgentJobToken(
  input: Omit<TreasuryAgentJob, 'iat' | 'exp'>,
  env?: TreasuryJobEnv,
  now = Date.now(),
): Promise<string> {
  return issueAgentJobTokenWithSecret(input, signingMaterial(env), now);
}

export async function verifyAgentJobToken(
  token: string,
  env?: TreasuryJobEnv,
  now = Date.now(),
): Promise<TreasuryAgentJob | null> {
  try {
    return await verifyAgentJobTokenWithSecret(token, signingMaterial(env), now);
  } catch {
    return null;
  }
}
