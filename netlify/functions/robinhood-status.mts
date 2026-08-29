import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { robinhoodManualCompletionRequired } from '../lib/robinhoodMcp.mts';
import { ROBINHOOD_EXECUTION_SYMBOL, ROBINHOOD_MAX_EXECUTION_SYMBOLS, type RobinhoodAdapter } from '../../src/brokers/robinhood/adapter.js';

/** GET /.netlify/functions/robinhood-status */
export default withErrorHandling('robinhood-status', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const manualCompletionRequired = robinhoodManualCompletionRequired();
  const ctx = await buildServerContext();
  const allowlist = ctx.config.agenticGrowthAllowlist
    .map((symbol) => symbol.toUpperCase())
    .filter((symbol) => ROBINHOOD_MAX_EXECUTION_SYMBOLS.includes(symbol as (typeof ROBINHOOD_MAX_EXECUTION_SYMBOLS)[number]));
  const adapter = ctx.adapters.find((item) => item.id === 'robinhood') as RobinhoodAdapter | undefined;
  if (!adapter || !adapter.isConfigured() || !adapter.capabilities.includes('read_quotes')) {
    return json({
      connected: false,
      executionEnabled: false,
      executionMode: ctx.config.agenticExecutionMode,
      connectUrl: '/.netlify/functions/robinhood-auth-start',
      manualCompletionRequired,
      symbol: ROBINHOOD_EXECUTION_SYMBOL,
      allowlist,
      accounts: [],
      quote: null,
      quotes: {},
      toolNames: [],
      note: 'Connect the official Robinhood Trading MCP to replace the Robinhood mock lane with production data.',
    });
  }

  const auth = await adapter.authenticate();
  if (!auth.ok) {
    return json({
      connected: false,
      executionEnabled: false,
      executionMode: ctx.config.agenticExecutionMode,
      connectUrl: '/.netlify/functions/robinhood-auth-start',
      manualCompletionRequired,
      symbol: ROBINHOOD_EXECUTION_SYMBOL,
      allowlist,
      accounts: [],
      quote: null,
      quotes: {},
      toolNames: [],
      note: auth.message,
    });
  }

  const [accountData, tools, quoteEntries] = await Promise.all([
    adapter.getAccountData(),
    adapter.listAvailableTools(),
    Promise.all(allowlist.map(async (symbol) => {
      try {
        return [symbol, await adapter.getQuote(symbol)] as const;
      } catch {
        return [symbol, null] as const;
      }
    })),
  ]);
  const quotes = Object.fromEntries(
    quoteEntries.filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] => entry[1] != null),
  );
  const quote = quotes[ROBINHOOD_EXECUTION_SYMBOL] ?? null;
  const toolNames = tools.map((tool) => tool.name);
  const executionToolsReady = ['review_equity_order', 'place_equity_order'].every((name) => toolNames.includes(name));
  const deploymentArmed = adapter.capabilities.includes('place_order') && executionToolsReady;
  const executionEnabled = deploymentArmed && ctx.config.agenticExecutionMode !== 'shadow';

  return json({
    connected: true,
    executionEnabled,
    executionMode: ctx.config.agenticExecutionMode,
    connectUrl: '/.netlify/functions/robinhood-auth-start',
    manualCompletionRequired,
    symbol: ROBINHOOD_EXECUTION_SYMBOL,
    allowlist,
    accounts: accountData.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      cash: account.cash,
      allocationEligible: account.allocationEligible,
      tradeEligible: account.tradeEligible,
    })),
    quote,
    quotes,
    toolNames,
    note: executionToolsReady
      ? ctx.config.agenticExecutionMode === 'shadow'
        ? 'Live Robinhood MCP connected. Shadow Mode is active: the strategy observes and records decisions but cannot create live previews.'
        : adapter.capabilities.includes('place_order')
          ? `Live Robinhood MCP connected. Human-confirmed BUY execution is constrained to: ${allowlist.join(', ')}.`
          : 'Live Robinhood MCP connected. The strategy is configured beyond Shadow Mode, but the deployment execution flag remains off.'
      : 'Robinhood is connected for reads, but the required equity order tools are not currently exposed to this OAuth session.',
  });
});
