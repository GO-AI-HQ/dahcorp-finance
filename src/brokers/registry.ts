import type { BrokerAccountData, BrokerAdapter } from './types.js';
import { RobinhoodAdapter, readRobinhoodConfig, type RobinhoodMcpGateway } from './robinhood/adapter.js';
import {
  SchwabAdapter,
  readSchwabConfig,
  type SchwabTokenStore,
} from './schwab/adapter.js';

/**
 * Broker registry. Constructed server-side only, once per request.
 *
 * The `fallback` supplier is how the seeded portfolio model reaches the
 * adapters without the adapters importing fixture data themselves.
 */
export function buildBrokerRegistry(
  env: Record<string, string | undefined>,
  fallback: (broker: 'robinhood' | 'schwab') => BrokerAccountData,
  options: { schwabTokenStore?: SchwabTokenStore; robinhoodGateway?: RobinhoodMcpGateway | null } = {},
): BrokerAdapter[] {
  return [
    new RobinhoodAdapter(readRobinhoodConfig(env), () => fallback('robinhood'), options.robinhoodGateway ?? undefined),
    new SchwabAdapter(
      readSchwabConfig(env),
      () => fallback('schwab'),
      fetch,
      options.schwabTokenStore,
    ),
  ];
}

export interface BrokerStatus {
  id: string;
  label: string;
  mode: string;
  configured: boolean;
  missing: string[];
  note: string;
  capabilities: string[];
  executionEnabled: boolean;
}

/** Safe-to-serialise adapter status. Contains no credential material. */
export function describeBrokers(adapters: BrokerAdapter[], env: Record<string, string | undefined>): BrokerStatus[] {
  return adapters.map((adapter) => {
    const status = adapter.configurationStatus();
    const mode =
      adapter.id === 'robinhood' ? readRobinhoodConfig(env).mode : adapter.id === 'schwab' ? readSchwabConfig(env).mode : 'mock';
    return {
      id: adapter.id,
      label: adapter.label,
      mode,
      configured: status.configured,
      missing: status.missing,
      note: status.note,
      capabilities: adapter.capabilities,
      executionEnabled: adapter.capabilities.includes('place_order'),
    };
  });
}
