import { describe, expect, it } from 'vitest';
import { validateRobinhoodExecution } from '../src/risk/execution.js';

const BASE = {
  symbol: 'NVDY',
  side: 'buy' as const,
  orderType: 'market' as const,
  quantity: 2,
  price: 20,
  brokerCash: 500,
  brokerCashFloor: 50,
  maxOrderNotional: 250,
  killSwitch: false,
  executionEnabled: true,
};

function codes(result: ReturnType<typeof validateRobinhoodExecution>) {
  return result.findings.map((finding) => finding.code);
}

describe('validateRobinhoodExecution', () => {
  it('approves a human-confirmable whole-share NVDY buy within Agentic buying power', () => {
    const result = validateRobinhoodExecution(BASE);
    expect(result.approved).toBe(true);
    expect(result.notional).toBe(40);
    expect(codes(result)).toContain('HUMAN_APPROVAL_REQUIRED');
  });

  it('hard-blocks symbols other than NVDY', () => {
    const result = validateRobinhoodExecution({ ...BASE, symbol: 'YMAG' });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('SYMBOL_NOT_ALLOWLISTED');
  });

  it('blocks sells and fractional quantities in the first Robinhood execution surface', () => {
    expect(codes(validateRobinhoodExecution({ ...BASE, side: 'sell' }))).toContain('BUY_ONLY');
    expect(codes(validateRobinhoodExecution({ ...BASE, quantity: 1.5 }))).toContain('WHOLE_SHARES_REQUIRED');
  });

  it('blocks an order above deployable Agentic buying power', () => {
    const result = validateRobinhoodExecution({ ...BASE, brokerCash: 70, brokerCashFloor: 50, quantity: 2, price: 20 });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('INSUFFICIENT_ROBINHOOD_CASH');
  });

  it('honours both the global kill switch and deployment flag', () => {
    expect(codes(validateRobinhoodExecution({ ...BASE, killSwitch: true }))).toContain('KILL_SWITCH');
    expect(codes(validateRobinhoodExecution({ ...BASE, executionEnabled: false }))).toContain('EXECUTION_DEPLOYMENT_DISABLED');
  });
});
