import type { RiskFinding } from './types.js';

export const LIVE_EXECUTION_SYMBOL = 'YMAG';
export const ROBINHOOD_LIVE_EXECUTION_SYMBOL = 'NVDY';

export interface LiveExecutionGateInput {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  quantity: number;
  price: number;
  brokerCash: number;
  brokerCashFloor: number;
  maxOrderNotional: number;
  killSwitch: boolean;
  executionEnabled: boolean;
  allowlist?: readonly string[];
  /** Robinhood: current confirmed shares when validating a sell. */
  heldQuantity?: number;
  /** Robinhood: result of get_equity_tradability when a fractional order is requested. */
  fractionalTradable?: boolean | null;
}

export interface LiveExecutionGateResult { approved: boolean; notional: number; deployableCash: number; findings: RiskFinding[]; }
function block(code: string, message: string, limit?: number, actual?: number): RiskFinding { return { code, severity: 'block', message, limit, actual }; }
function info(code: string, message: string): RiskFinding { return { code, severity: 'info', message }; }

export function validateLiveExecution(input: LiveExecutionGateInput): LiveExecutionGateResult {
  const findings: RiskFinding[] = [];
  const symbol = input.symbol.toUpperCase().trim();
  const deployableCash = Math.max(0, input.brokerCash - Math.max(0, input.brokerCashFloor));
  const notional = input.quantity * input.price;
  if (!input.executionEnabled) findings.push(block('EXECUTION_DEPLOYMENT_DISABLED', 'Live Schwab execution is disabled by deployment configuration.'));
  if (input.killSwitch) findings.push(block('KILL_SWITCH', 'The global kill switch is engaged. No live order may be submitted.'));
  if (symbol !== LIVE_EXECUTION_SYMBOL) findings.push(block('SYMBOL_NOT_ALLOWLISTED', `Live execution is restricted to ${LIVE_EXECUTION_SYMBOL}.`));
  if (input.side !== 'buy') findings.push(block('BUY_ONLY', 'The current Schwab live execution policy permits buys only.'));
  if (input.orderType !== 'market') findings.push(block('MARKET_ONLY', 'The current live execution policy permits market orders only.'));
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) findings.push(block('WHOLE_SHARES_REQUIRED', 'Schwab API execution is currently limited to positive whole-share quantities.'));
  if (!Number.isFinite(input.price) || input.price <= 0) findings.push(block('LIVE_PRICE_REQUIRED', 'A current positive Schwab market price is required before execution.'));
  if (Number.isFinite(notional) && notional > input.maxOrderNotional) findings.push(block('MAX_ORDER_NOTIONAL', `The estimated $${notional.toFixed(2)} order exceeds the configured $${input.maxOrderNotional.toFixed(2)} single-order maximum.`, input.maxOrderNotional, notional));
  if (Number.isFinite(notional) && notional > deployableCash) findings.push(block('INSUFFICIENT_SCHWAB_CASH', `The estimated $${notional.toFixed(2)} order exceeds the $${deployableCash.toFixed(2)} of currently deployable Schwab cash after the settlement floor.`, deployableCash, notional));
  findings.push(info('HUMAN_APPROVAL_REQUIRED', 'Passing this gate never submits an order by itself. The investor must explicitly confirm the stored preview.'));
  return { approved: !findings.some((finding) => finding.severity === 'block'), notional: Number.isFinite(notional) ? notional : 0, deployableCash, findings };
}

/** Robinhood Agentic live gate: approved symbols, market orders, fractional-aware, buy or sell, human confirmation. */
export function validateRobinhoodExecution(input: LiveExecutionGateInput): LiveExecutionGateResult {
  const findings: RiskFinding[] = [];
  const symbol = input.symbol.toUpperCase().trim();
  const allowlist = (input.allowlist?.length ? input.allowlist : [ROBINHOOD_LIVE_EXECUTION_SYMBOL]).map((item) => item.toUpperCase());
  const deployableCash = Math.max(0, input.brokerCash - Math.max(0, input.brokerCashFloor));
  const notional = input.quantity * input.price;
  const fractional = Number.isFinite(input.quantity) && Math.abs(input.quantity - Math.round(input.quantity)) > 1e-9;

  if (!input.executionEnabled) findings.push(block('EXECUTION_DEPLOYMENT_DISABLED', 'Live Robinhood execution is disabled by deployment configuration.'));
  if (input.killSwitch) findings.push(block('KILL_SWITCH', 'The global kill switch is engaged. No live order may be submitted.'));
  if (!allowlist.includes(symbol)) findings.push(block('SYMBOL_NOT_ALLOWLISTED', `Robinhood execution is restricted to the configured Agentic allowlist: ${allowlist.join(', ')}.`));
  if (input.orderType !== 'market') findings.push(block('MARKET_ONLY', 'The current Robinhood live execution policy permits market orders only.'));
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) findings.push(block('POSITIVE_QUANTITY_REQUIRED', 'Robinhood execution requires a positive finite share quantity.'));
  if (fractional && input.fractionalTradable === false) findings.push(block('FRACTIONAL_NOT_SUPPORTED', `${symbol} is not currently eligible for fractional trading according to Robinhood.`));
  if (fractional && input.fractionalTradable == null) findings.push(info('FRACTIONAL_REVIEW_REQUIRED', 'Fractional eligibility will be confirmed by Robinhood tradability/review before submission.'));
  if (!Number.isFinite(input.price) || input.price <= 0) findings.push(block('LIVE_PRICE_REQUIRED', 'A current positive Robinhood market price is required before execution.'));
  if (Number.isFinite(notional) && notional > input.maxOrderNotional) findings.push(block('MAX_ORDER_NOTIONAL', `The estimated $${notional.toFixed(2)} order exceeds the configured $${input.maxOrderNotional.toFixed(2)} single-order maximum.`, input.maxOrderNotional, notional));

  if (input.side === 'buy') {
    if (Number.isFinite(notional) && notional > deployableCash) findings.push(block('INSUFFICIENT_ROBINHOOD_CASH', `The estimated $${notional.toFixed(2)} order exceeds the $${deployableCash.toFixed(2)} of currently deployable Robinhood Agentic buying power after the settlement floor.`, deployableCash, notional));
  } else {
    const held = input.heldQuantity;
    if (!Number.isFinite(held) || (held ?? 0) <= 0) findings.push(block('NO_CONFIRMED_POSITION', `A live ${symbol} position is required before DAHCorp can preview a sell.`));
    else if (input.quantity > (held ?? 0) + 1e-9) findings.push(block('SELL_EXCEEDS_POSITION', `The requested ${input.quantity.toFixed(6)} shares exceed the ${(held ?? 0).toFixed(6)} shares currently reported by Robinhood.`, held, input.quantity));
  }

  findings.push(info('HUMAN_APPROVAL_REQUIRED', `Passing this gate never submits a ${input.side} by itself. The investor must explicitly confirm the single-use broker preview.`));
  return { approved: !findings.some((finding) => finding.severity === 'block'), notional: Number.isFinite(notional) ? notional : 0, deployableCash, findings };
}
