import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { buildServerContext } from '../lib/context.mts';
import { SCHWAB_EXECUTION_SYMBOL, type SchwabAdapter } from '../../src/brokers/schwab/adapter.js';

/** GET /.netlify/functions/schwab-status */
export default withErrorHandling('schwab-status', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  const ctx = await buildServerContext();
  const adapter = ctx.adapters.find((item) => item.id === 'schwab') as SchwabAdapter | undefined;
  if (!adapter || !adapter.isConfigured() || !adapter.capabilities.includes('read_quotes')) {
    return json({
      connected: false,
      executionEnabled: false,
      connectUrl: '/.netlify/functions/schwab-auth-start',
      symbol: SCHWAB_EXECUTION_SYMBOL,
      accounts: [],
      quote: null,
      fundingApiAvailable: false,
      note: 'Schwab production mode and credentials are required before the brokerage can be connected.',
    });
  }

  const auth = await adapter.authenticate();
  if (!auth.ok) {
    return json({
      connected: false,
      executionEnabled: adapter.capabilities.includes('place_order'),
      connectUrl: '/.netlify/functions/schwab-auth-start',
      symbol: SCHWAB_EXECUTION_SYMBOL,
      accounts: [],
      quote: null,
      fundingApiAvailable: false,
      note: 'Schwab authorization is required or has expired.',
    });
  }

  const [accountData, quote] = await Promise.all([
    adapter.getAccountData(),
    adapter.getQuote(SCHWAB_EXECUTION_SYMBOL),
  ]);

  return json({
    connected: true,
    executionEnabled: adapter.capabilities.includes('place_order'),
    connectUrl: '/.netlify/functions/schwab-auth-start',
    symbol: SCHWAB_EXECUTION_SYMBOL,
    accounts: accountData.accounts
      .filter((account) => account.type === 'taxable')
      .map((account) => ({
        id: account.id,
        name: account.name,
        cash: account.cash,
        allocationEligible: account.allocationEligible,
        tradeEligible: account.tradeEligible,
      })),
    quote,
    fundingApiAvailable: false,
    note: adapter.capabilities.includes('place_order')
      ? 'Live Schwab data connected. YMAG whole-share buys require an explicit preview and confirmation.'
      : 'Live Schwab data connected. Set SCHWAB_EXECUTION_ENABLED=true to permit the guarded YMAG execution path.',
  });
});
