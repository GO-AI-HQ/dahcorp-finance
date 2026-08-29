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
  allowlist: ['NVDY', 'SEMI', 'SOXL'],
};

function codes(result: ReturnType<typeof validateRobinhoodExecution>) {
  return result.findings.map((finding) => finding.code);
}

describe('validateRobinhoodExecution', () => {
  it('approves a human-confirmable whole-share buy within Agentic buying power', () => {
    const result = validateRobinhoodExecution(BASE);
    expect(result.approved).toBe(true);
    expect(result.notional).toBe(40);
    expect(codes(result)).toContain('HUMAN_APPROVAL_REQUIRED');
  });

  it('supports configured strategy symbols but blocks symbols outside the Agentic allowlist', () => {
    expect(validateRobinhoodExecution({ ...BASE, symbol: 'SEMI' }).approved).toBe(true);
    const blocked = validateRobinhoodExecution({ ...BASE, symbol: 'YMAG' });
    expect(blocked.approved).toBe(false);
    expect(codes(blocked)).toContain('SYMBOL_NOT_ALLOWLISTED');
  });

  it('allows a sell only when a confirmed position is large enough', () => {
    const approved = validateRobinhoodExecution({ ...BASE, side: 'sell', quantity: 1.25, heldQuantity: 2, fractionalTradable: true });
    expect(approved.approved).toBe(true);
    expect(codes(approved)).not.toContain('NO_CONFIRMED_POSITION');
    expect(codes(approved)).not.toContain('SELL_EXCEEDS_POSITION');

    const noPosition = validateRobinhoodExecution({ ...BASE, side: 'sell', heldQuantity: 0 });
    expect(noPosition.approved).toBe(false);
    expect(codes(noPosition)).toContain('NO_CONFIRMED_POSITION');

    const tooLarge = validateRobinhoodExecution({ ...BASE, side: 'sell', quantity: 3, heldQuantity: 2 });
    expect(tooLarge.approved).toBe(false);
    expect(codes(tooLarge)).toContain('SELL_EXCEEDS_POSITION');
  });

  it('allows eligible fractional orders and blocks explicitly non-fractionable symbols', () => {
    const eligible = validateRobinhoodExecution({ ...BASE, symbol: 'SEMI', quantity: 0.4, fractionalTradable: true });
    expect(eligible.approved).toBe(true);
    expect(codes(eligible)).not.toContain('FRACTIONAL_NOT_SUPPORTED');

    const ineligible = validateRobinhoodExecution({ ...BASE, symbol: 'SEMI', quantity: 0.4, fractionalTradable: false });
    expect(ineligible.approved).toBe(false);
    expect(codes(ineligible)).toContain('FRACTIONAL_NOT_SUPPORTED');

    const unknown = validateRobinhoodExecution({ ...BASE, symbol: 'SEMI', quantity: 0.4, fractionalTradable: null });
    expect(unknown.approved).toBe(true);
    expect(codes(unknown)).toContain('FRACTIONAL_REVIEW_REQUIRED');
  });

  it('applies the cash test to buys but not to sells', () => {
    const buy = validateRobinhoodExecution({ ...BASE, brokerCash: 70, brokerCashFloor: 50, quantity: 2, price: 20 });
    expect(buy.approved).toBe(false);
    expect(codes(buy)).toContain('INSUFFICIENT_ROBINHOOD_CASH');

    const sell = validateRobinhoodExecution({ ...BASE, side: 'sell', brokerCash: 0, brokerCashFloor: 50, quantity: 2, price: 20, heldQuantity: 2 });
    expect(sell.approved).toBe(true);
    expect(codes(sell)).not.toContain('INSUFFICIENT_ROBINHOOD_CASH');
  });

  it('blocks orders above the configured single-order maximum', () => {
    const result = validateRobinhoodExecution({ ...BASE, quantity: 20, price: 20, brokerCash: 1000 });
    expect(result.approved).toBe(false);
    expect(codes(result)).toContain('MAX_ORDER_NOTIONAL');
  });

  it('honours both the global kill switch and deployment flag', () => {
    expect(codes(validateRobinhoodExecution({ ...BASE, killSwitch: true }))).toContain('KILL_SWITCH');
    expect(codes(validateRobinhoodExecution({ ...BASE, executionEnabled: false }))).toContain('EXECUTION_DEPLOYMENT_DISABLED');
  });
});
