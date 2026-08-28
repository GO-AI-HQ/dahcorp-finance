import { describe, expect, it } from 'vitest';
import { validateLiveExecution } from '../src/risk/execution.js';

const BASE = {
  symbol: 'YMAG',
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

function codes(result: ReturnType<typeof validateLiveExecution>) {
  return result.findings.map((finding) => finding.code);
}

describe('validateLiveExecution', () => {
  it('approves a human-confirmable whole-share YMAG buy within broker cash and order limits', () => {
    const result = validateLiveExecution(BASE);
    expect(result.approved).toBe(true);
    expect(result.notional).toBe(40);
    expect(result.deployableCash).toBe(450);
    expect(codes(result)).toContain('HUMAN_APPROVAL_REQUIRED');
    expect(result.findings.some((finding) => finding.severity === 'block')).toBe(false);
  });

  it('hard-blocks every symbol except YMAG', () => {
    const result = validateLiveExecution({ ...BASE, symbol: 'NVDY' });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('SYMBOL_NOT_ALLOWLISTED');
  });

  it('blocks sells even when they are YMAG', () => {
    const result = validateLiveExecution({ ...BASE, side: 'sell' });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('BUY_ONLY');
  });

  it('blocks fractional quantities in the first live Schwab execution surface', () => {
    const result = validateLiveExecution({ ...BASE, quantity: 1.5 });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('WHOLE_SHARES_REQUIRED');
  });

  it('blocks orders that would consume the protected Schwab cash floor', () => {
    const result = validateLiveExecution({
      ...BASE,
      brokerCash: 100,
      brokerCashFloor: 50,
      quantity: 3,
      price: 20,
    });
    expect(result.approved).toBe(false);
    expect(result.deployableCash).toBe(50);
    expect(codes(result)).toContain('INSUFFICIENT_SCHWAB_CASH');
  });

  it('blocks orders above the configured per-order notional maximum', () => {
    const result = validateLiveExecution({ ...BASE, quantity: 13, price: 20 });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('MAX_ORDER_NOTIONAL');
  });

  it('honours the global kill switch even when every other condition passes', () => {
    const result = validateLiveExecution({ ...BASE, killSwitch: true });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('KILL_SWITCH');
  });

  it('blocks execution unless the deployment flag is explicitly enabled', () => {
    const result = validateLiveExecution({ ...BASE, executionEnabled: false });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('EXECUTION_DEPLOYMENT_DISABLED');
  });
});
