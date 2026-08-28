import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { ROBINHOOD_EXECUTION_SYMBOL, type RobinhoodAdapter } from '../../src/brokers/robinhood/adapter.js';

/** GET /.netlify/functions/robinhood-status */
export default withErrorHandling('robinhood-status', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const ctx = await buildServerContext();
  const adapter = ctx.adapters.find((item) => item.id === 'robinhood') as RobinhoodAdapter | undefined;
  if (!adapter || !adapter.isConfigured() || !adapter.capabilities.includes('read_quotes')) {
    return json({
      connected: false,
      executionEnabled: false,
      connectUrl: '/.netlify/functions/robinhood-auth-start',
      symbol: ROBINHOOD_EXECUTION_SYMBOL,
      accounts: [],
      quote: null,
      toolNames: [],
      note: 'Connect the official Robinhood Trading MCP to replace the Robinhood mock lane with production data.',
    });
  }

  const auth = await adapter.authenticate();
  if (!auth.ok) {
    return json({
      connected: false,
      executionEnabled: false,
      connectUrl: '/.netlify/functions/robinhood-auth-start',
      symbol: ROBINHOOD_EXECUTION_SYMBOL,
      accounts: [],
      quote: null,
      toolNames: [],
      note: auth.message,
    });
  }

  const [accountData, quote, tools] = await Promise.all([
    adapter.getAccountData(),
    adapter.getQuote(ROBINHOOD_EXECUTION_SYMBOL),
    adapter.listAvailableTools(),
  ]);
  const toolNames = tools.map((tool) => tool.name);
  const executionToolsReady = ['review_equity_order', 'place_equity_order'].every((name) => toolNames.includes(name));

  return json({
    connected: true,
    executionEnabled: adapter.capabilities.includes('place_order') && executionToolsReady,
    connectUrl: '/.netlify/functions/robinhood-auth-start',
    symbol: ROBINHOOD_EXECUTION_SYMBOL,
    accounts: accountData.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      cash: account.cash,
      allocationEligible: account.allocationEligible,
      tradeEligible: account.tradeEligible,
    })),
    quote,
    toolNames,
    note: executionToolsReady
      ? adapter.capabilities.includes('place_order')
        ? 'Live Robinhood MCP connected. NVDY buys remain human-confirmed and restricted to the Agentic account.'
        : 'Live Robinhood MCP connected. Set ROBINHOOD_EXECUTION_ENABLED=true after verifying the Agentic account and live data.'
      : 'Robinhood is connected for reads, but the required equity order tools are not currently exposed to this OAuth session.',
  });
});
