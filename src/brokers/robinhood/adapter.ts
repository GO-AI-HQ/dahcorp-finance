import type { Account, AccountType, Holding, Sleeve } from '../../core/types.js';
import { getInstrumentOrFallback } from '../../core/universe.js';
import type { ProposedOrder } from '../../risk/types.js';
import {
  BrokerNotConfiguredError,
  ExecutionDisabledError,
  type BrokerAccountData,
  type BrokerAdapter,
  type BrokerCapability,
  type OrderPreviewResult,
  type OrderStatus,
} from '../types.js';

export const ROBINHOOD_DEFAULT_MCP_ENDPOINT = 'https://agent.robinhood.com/mcp/trading';
/** Maximum code-level universe. Strategy settings may narrow this, never widen it. */
export const ROBINHOOD_MAX_EXECUTION_SYMBOLS = ['NVDY', 'SOXL', 'TSMX', 'SEMI', 'SMH', 'AMD'] as const;
/** Backwards-compatible primary symbol used by the first execution card. */
export const ROBINHOOD_EXECUTION_SYMBOL = 'NVDY';

export interface RobinhoodMcpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; [key: string]: unknown }>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface RobinhoodMcpGateway {
  listTools(): Promise<RobinhoodMcpTool[]>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface RobinhoodConfig {
  mcpEndpoint?: string;
  mode: 'mock' | 'manual' | 'live';
  executionEnabled: boolean;
}

export interface RobinhoodQuoteSnapshot {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  previousClose: number | null;
  asOf: string;
}

interface RawAccount {
  account_number?: string;
  rhs_account_number?: string;
  type?: string;
  brokerage_account_type?: string;
  nickname?: string;
  is_default?: boolean;
  agentic_allowed?: boolean;
  cash?: string | number;
  buying_power?: string | number | { buying_power?: string | number };
}

interface RawPosition {
  account_number?: string;
  account_id?: string;
  symbol?: string;
  quantity?: string | number;
  average_buy_price?: string | number;
  average_cost?: string | number;
  type?: string;
}

export function robinhoodExecutionEnabled(env: Record<string, string | undefined>): boolean {
  return (env.ROBINHOOD_EXECUTION_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function readRobinhoodConfig(env: Record<string, string | undefined>): RobinhoodConfig {
  const declared = env.ROBINHOOD_MODE?.trim().toLowerCase() as RobinhoodConfig['mode'] | undefined;
  return {
    mcpEndpoint: env.ROBINHOOD_MCP_ENDPOINT?.trim() || ROBINHOOD_DEFAULT_MCP_ENDPOINT,
    mode: declared === 'manual' || declared === 'live' || declared === 'mock' ? declared : 'mock',
    executionEnabled: robinhoodExecutionEnabled(env),
  };
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nestedData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  return record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : record;
}

function arrayAt(value: unknown, ...keys: string[]): unknown[] {
  const data = nestedData(value);
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return [];
}

function accountType(raw: RawAccount): AccountType {
  const value = `${raw.brokerage_account_type ?? ''} ${raw.type ?? ''}`.toLowerCase();
  if (value.includes('roth')) return 'roth_ira';
  return 'taxable';
}

function sleeveFor(symbol: string): Sleeve {
  return getInstrumentOrFallback(symbol).sleeve;
}

function rawAccountNumber(raw: RawAccount): string | null {
  return raw.account_number?.trim() || raw.rhs_account_number?.trim() || null;
}

function last4(value: string): string {
  return value.slice(-4).padStart(4, '•');
}

async function safeAccountId(accountNumber: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`robinhood:${accountNumber}`));
  return `robinhood-${Array.from(new Uint8Array(digest)).slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function schemaValue(tool: RobinhoodMcpTool | undefined, key: string, value: string | number): string | number {
  const type = tool?.inputSchema?.properties?.[key]?.type;
  if (type === 'string') return String(value);
  if (type === 'number' || type === 'integer') return Number(value);
  return value;
}

export class RobinhoodAdapter implements BrokerAdapter {
  readonly id = 'robinhood' as const;
  readonly label = 'Robinhood';
  private tools: RobinhoodMcpTool[] | null = null;

  constructor(
    private readonly config: RobinhoodConfig,
    private readonly fallback: () => BrokerAccountData,
    private readonly gateway?: RobinhoodMcpGateway,
  ) {}

  get capabilities(): BrokerCapability[] {
    if (this.config.mode !== 'live' || !this.gateway) return ['read_accounts', 'read_positions'];
    const capabilities: BrokerCapability[] = ['read_accounts', 'read_positions', 'read_quotes', 'preview_order', 'order_status'];
    if (this.config.executionEnabled) capabilities.push('place_order');
    return capabilities;
  }

  isConfigured(): boolean {
    return this.config.mode !== 'live' || Boolean(this.config.mcpEndpoint && this.gateway);
  }

  configurationStatus() {
    const missing: string[] = [];
    if (this.config.mode === 'live') {
      if (!this.config.mcpEndpoint) missing.push('ROBINHOOD_MCP_ENDPOINT');
      if (!this.gateway) missing.push('Robinhood OAuth authorization');
    }
    return {
      configured: this.isConfigured(),
      missing,
      note:
        this.config.mode === 'mock'
          ? 'Running against the seeded read-only Robinhood model.'
          : this.config.mode === 'manual'
            ? 'Robinhood positions are maintained manually.'
            : this.config.executionEnabled
              ? `Official Robinhood Trading MCP connected; guarded BUY execution is available only for ${ROBINHOOD_MAX_EXECUTION_SYMBOLS.join(', ')}.`
              : 'Official Robinhood Trading MCP connected read-only; Agentic execution is not armed.',
    };
  }

  private async availableTools(): Promise<RobinhoodMcpTool[]> {
    if (!this.gateway) throw new BrokerNotConfiguredError('Robinhood', ['OAuth authorization']);
    if (!this.tools) this.tools = await this.gateway.listTools();
    return this.tools;
  }

  private async tool(name: string): Promise<RobinhoodMcpTool> {
    const found = (await this.availableTools()).find((item) => item.name === name);
    if (!found) throw new Error(`Robinhood MCP does not expose required tool ${name}.`);
    return found;
  }

  async authenticate() {
    if (this.config.mode !== 'live') return { ok: true, message: `Robinhood adapter in ${this.config.mode} mode.` };
    if (!this.gateway) return { ok: false, message: 'Robinhood OAuth authorization is required.' };
    try {
      const names = new Set((await this.availableTools()).map((item) => item.name));
      const required = ['get_accounts', 'get_equity_positions', 'get_equity_quotes'];
      const missing = required.filter((name) => !names.has(name));
      return missing.length
        ? { ok: false, message: `Robinhood MCP is missing required tools: ${missing.join(', ')}.` }
        : { ok: true, message: 'Robinhood Trading MCP authenticated.' };
    } catch {
      return { ok: false, message: 'Robinhood Trading MCP authentication is unavailable or expired.' };
    }
  }

  async listAvailableTools(): Promise<RobinhoodMcpTool[]> {
    return this.availableTools();
  }

  private async rawAccounts(): Promise<RawAccount[]> {
    if (!this.gateway) throw new BrokerNotConfiguredError('Robinhood', ['OAuth authorization']);
    await this.tool('get_accounts');
    const payload = await this.gateway.callTool('get_accounts', {});
    return arrayAt(payload, 'accounts', 'results').filter((item): item is RawAccount => Boolean(item && typeof item === 'object'));
  }

  private async accountNumberFor(safeId: string, requireAgentic = false): Promise<{ raw: RawAccount; accountNumber: string }> {
    for (const raw of await this.rawAccounts()) {
      const accountNumber = rawAccountNumber(raw);
      if (!accountNumber) continue;
      if ((await safeAccountId(accountNumber)) === safeId) {
        if (requireAgentic && raw.agentic_allowed !== true) throw new Error('Robinhood permits trading only in the Agentic account.');
        return { raw, accountNumber };
      }
    }
    throw new Error('The selected Robinhood account could not be resolved.');
  }

  private async callForAccount(name: string, accountNumber: string): Promise<unknown> {
    const tool = await this.tool(name);
    const properties = tool.inputSchema?.properties ?? {};
    const args: Record<string, unknown> = {};
    if ('account_number' in properties) args.account_number = accountNumber;
    return this.gateway!.callTool(name, args);
  }

  private async portfolioCash(raw: RawAccount, accountNumber: string): Promise<number> {
    const fallbackBuyingPower =
      typeof raw.buying_power === 'object' && raw.buying_power
        ? toNumber(raw.buying_power.buying_power)
        : toNumber(raw.buying_power);
    try {
      const tool = await this.tool('get_portfolio');
      const properties = tool.inputSchema?.properties ?? {};
      const args: Record<string, unknown> = {};
      if ('account_number' in properties) args.account_number = accountNumber;
      const data = nestedData(await this.gateway!.callTool('get_portfolio', args));
      const buyingPower = data.buying_power;
      if (buyingPower && typeof buyingPower === 'object') {
        const amount = toNumber((buyingPower as Record<string, unknown>).buying_power);
        if (amount > 0) return amount;
      }
      const direct = toNumber(buyingPower);
      if (direct > 0) return direct;
      const cash = toNumber(data.cash);
      return cash || fallbackBuyingPower || toNumber(raw.cash);
    } catch {
      return fallbackBuyingPower || toNumber(raw.cash);
    }
  }

  async getAccountData(): Promise<BrokerAccountData> {
    if (this.config.mode !== 'live') return this.fallback();
    const auth = await this.authenticate();
    if (!auth.ok) throw new BrokerNotConfiguredError('Robinhood', ['OAuth authorization']);

    const rawAccounts = await this.rawAccounts();
    const accounts: Account[] = [];
    const accountMap = new Map<string, string>();
    for (const raw of rawAccounts) {
      const accountNumber = rawAccountNumber(raw);
      if (!accountNumber) continue;
      const id = await safeAccountId(accountNumber);
      accountMap.set(accountNumber, id);
      if (raw.account_number) accountMap.set(raw.account_number, id);
      if (raw.rhs_account_number) accountMap.set(raw.rhs_account_number, id);
      const cash = await this.portfolioCash(raw, accountNumber);
      accounts.push({
        id,
        broker: 'robinhood',
        name: raw.nickname?.trim() || `Robinhood ${raw.agentic_allowed ? 'Agentic ' : ''}••••${last4(accountNumber)}`,
        type: accountType(raw),
        role: raw.agentic_allowed ? 'Agentic execution account' : 'Robinhood read-only brokerage account',
        cash,
        allocationEligible: raw.agentic_allowed === true,
        tradeEligible: raw.agentic_allowed === true,
        dataQuality: 'live',
      });
    }

    const positionTool = await this.tool('get_equity_positions');
    const properties = positionTool.inputSchema?.properties ?? {};
    const holdings: Holding[] = [];
    const seen = new Set<string>();
    const positionPayloads: { accountNumber: string | null; payload: unknown }[] = [];
    if ('account_number' in properties) {
      for (const raw of rawAccounts) {
        const accountNumber = rawAccountNumber(raw);
        if (accountNumber) positionPayloads.push({ accountNumber, payload: await this.callForAccount('get_equity_positions', accountNumber) });
      }
    } else {
      positionPayloads.push({ accountNumber: null, payload: await this.gateway!.callTool('get_equity_positions', {}) });
    }

    for (const entry of positionPayloads) {
      for (const item of arrayAt(entry.payload, 'positions', 'results')) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as RawPosition;
        const symbol = raw.symbol?.trim().toUpperCase();
        const shares = toNumber(raw.quantity);
        if (!symbol || shares <= 0) continue;
        const accountNumber = raw.account_number?.trim() || raw.account_id?.trim() || entry.accountNumber;
        const accountId = accountNumber ? accountMap.get(accountNumber) : accounts.length === 1 ? accounts[0]?.id : undefined;
        if (!accountId) continue; // Never guess which account owns a position.
        const key = `${accountId}:${symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const average = toNumber(raw.average_buy_price ?? raw.average_cost);
        const instrument = getInstrumentOrFallback(symbol);
        const costBasisTotal = average * shares;
        holdings.push({
          id: key,
          accountId,
          symbol,
          shares,
          costBasisTotal,
          tacticalCostBasisTotal: instrument.leverage > 1 ? costBasisTotal : undefined,
          sleeve: sleeveFor(symbol),
          legacy: false,
          verification: 'CONFIRMED',
        });
      }
    }

    return { accounts, holdings, asOf: new Date().toISOString() };
  }

  async getQuote(symbol: string): Promise<RobinhoodQuoteSnapshot> {
    if (this.config.mode !== 'live' || !this.gateway) throw new BrokerNotConfiguredError('Robinhood', ['OAuth authorization']);
    const normalized = symbol.toUpperCase().trim();
    await this.tool('get_equity_quotes');
    const payload = await this.gateway.callTool('get_equity_quotes', { symbols: [normalized] });
    const rows = arrayAt(payload, 'results', 'quotes');
    const row = (rows[0] && typeof rows[0] === 'object' ? rows[0] : {}) as Record<string, unknown>;
    const quote = (row.quote && typeof row.quote === 'object' ? row.quote : row) as Record<string, unknown>;
    const price = toNumber(quote.last_trade_price ?? quote.last_price ?? quote.mark_price ?? quote.price);
    if (price <= 0) throw new Error(`Robinhood returned no usable quote for ${normalized}.`);
    return {
      symbol: String(quote.symbol ?? normalized).toUpperCase(),
      price,
      bid: toNumber(quote.bid_price) || null,
      ask: toNumber(quote.ask_price) || null,
      previousClose: toNumber(quote.previous_close ?? row.previous_close) || null,
      asOf: String(quote.updated_at ?? quote.last_trade_timestamp ?? new Date().toISOString()),
    };
  }

  private async orderArgs(toolName: 'review_equity_order' | 'place_equity_order', order: ProposedOrder): Promise<Record<string, unknown>> {
    const symbol = order.symbol.toUpperCase().trim();
    if (!ROBINHOOD_MAX_EXECUTION_SYMBOLS.includes(symbol as (typeof ROBINHOOD_MAX_EXECUTION_SYMBOLS)[number]) || order.side !== 'buy' || order.orderType !== 'market') {
      throw new Error(`Robinhood execution transport is hard-allowlisted to BUY market orders in: ${ROBINHOOD_MAX_EXECUTION_SYMBOLS.join(', ')}.`);
    }
    if (typeof order.quantity !== 'number' || !Number.isInteger(order.quantity) || order.quantity <= 0) {
      throw new Error('Robinhood live execution currently requires a positive whole-share quantity.');
    }
    const { accountNumber } = await this.accountNumberFor(order.accountId, true);
    const tool = await this.tool(toolName);
    const properties = tool.inputSchema?.properties ?? {};
    const args: Record<string, unknown> = {};
    if ('account_number' in properties) args.account_number = accountNumber;
    if ('symbol' in properties) args.symbol = symbol;
    if ('side' in properties) args.side = 'buy';
    if ('order_type' in properties) args.order_type = 'market';
    if ('type' in properties) args.type = 'market';
    if ('quantity' in properties) args.quantity = schemaValue(tool, 'quantity', order.quantity);
    if ('time_in_force' in properties) args.time_in_force = 'gfd';
    if ('market_hours' in properties) args.market_hours = 'regular_hours';
    if (toolName === 'place_equity_order' && 'ref_id' in properties) args.ref_id = crypto.randomUUID();

    for (const required of tool.inputSchema?.required ?? []) {
      if (!(required in args)) throw new Error(`Robinhood ${toolName} requires unsupported parameter ${required}; no order was submitted.`);
    }
    return args;
  }

  async previewOrder(order: ProposedOrder): Promise<OrderPreviewResult> {
    if (this.config.mode !== 'live' || !this.gateway) throw new BrokerNotConfiguredError('Robinhood', ['OAuth authorization']);
    const payload = await this.gateway.callTool('review_equity_order', await this.orderArgs('review_equity_order', order));
    const data = nestedData(payload);
    const warnings = Array.isArray(data.warnings)
      ? data.warnings.map((item) => typeof item === 'string' ? item : JSON.stringify(item))
      : Array.isArray(data.alerts)
        ? data.alerts.map((item) => typeof item === 'string' ? item : JSON.stringify(item))
        : [];
    return {
      accepted: true,
      estimatedPrice: toNumber(data.estimated_price ?? data.price) || null,
      estimatedShares: order.quantity ?? null,
      estimatedCommission: toNumber(data.commission ?? data.fees),
      warnings,
      previewToken: null,
    };
  }

  async placeOrder(order: ProposedOrder): Promise<OrderStatus> {
    if (this.config.mode !== 'live' || !this.config.executionEnabled || !this.gateway) throw new ExecutionDisabledError('Robinhood');
    const payload = await this.gateway.callTool('place_equity_order', await this.orderArgs('place_equity_order', order));
    const data = nestedData(payload);
    const rawOrder = (data.order && typeof data.order === 'object' ? data.order : data) as Record<string, unknown>;
    const state = String(rawOrder.state ?? rawOrder.status ?? 'pending').toLowerCase();
    const status: OrderStatus['status'] =
      state.includes('fill') && !state.includes('partial') ? 'filled' :
      state.includes('partial') ? 'partial' :
      state.includes('reject') || state.includes('fail') ? 'rejected' :
      state.includes('cancel') ? 'cancelled' : 'pending';
    return {
      brokerOrderId: typeof rawOrder.id === 'string' ? rawOrder.id : typeof rawOrder.order_id === 'string' ? rawOrder.order_id : null,
      status,
      filledShares: toNumber(rawOrder.cumulative_quantity ?? rawOrder.filled_quantity),
      filledAveragePrice: toNumber(rawOrder.average_price ?? rawOrder.filled_average_price) || null,
      message: `Robinhood accepted the ${order.symbol.toUpperCase()} order request with status ${status}.`,
    };
  }

  async getOrderStatus(brokerOrderId: string): Promise<OrderStatus> {
    if (this.config.mode !== 'live' || !this.gateway) throw new BrokerNotConfiguredError('Robinhood', ['OAuth authorization']);
    const agentic = (await this.rawAccounts()).find((item) => item.agentic_allowed === true && rawAccountNumber(item));
    const tool = await this.tool('get_equity_orders');
    const properties = tool.inputSchema?.properties ?? {};
    const args: Record<string, unknown> = {};
    const agenticAccountNumber = agentic ? rawAccountNumber(agentic) : null;
    if ('account_number' in properties && agenticAccountNumber) args.account_number = agenticAccountNumber;
    const payload = await this.gateway.callTool('get_equity_orders', args);
    const found = arrayAt(payload, 'orders', 'results').find((item) => item && typeof item === 'object' && ((item as Record<string, unknown>).id === brokerOrderId || (item as Record<string, unknown>).order_id === brokerOrderId));
    if (!found || typeof found !== 'object') return { brokerOrderId, status: 'pending', filledShares: 0, filledAveragePrice: null, message: 'Order not found in the latest Robinhood history response.' };
    const raw = found as Record<string, unknown>;
    const state = String(raw.state ?? raw.status ?? 'pending').toLowerCase();
    return {
      brokerOrderId,
      status: state.includes('fill') && !state.includes('partial') ? 'filled' : state.includes('partial') ? 'partial' : state.includes('reject') ? 'rejected' : state.includes('cancel') ? 'cancelled' : 'pending',
      filledShares: toNumber(raw.cumulative_quantity ?? raw.filled_quantity),
      filledAveragePrice: toNumber(raw.average_price) || null,
      message: `Robinhood reports order state ${state}.`,
    };
  }
}

export type RobinhoodReadOnlyModel = { accounts: Account[]; holdings: Holding[] };
