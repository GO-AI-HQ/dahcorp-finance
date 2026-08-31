import { json, methodNotAllowed, withErrorHandling } from '../lib/http.mts';
import { requireSession } from '../lib/session.mts';
import { recentIntelligenceEvents } from '../lib/intelligenceStore.mts';
import { refreshCashYieldBenchmark } from '../lib/cashYieldBenchmark.mts';
import { refreshSavingsRateBenchmark, storedSavingsRateBenchmark } from '../lib/rateApi.mts';

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function treasuryBenchmark() {
  let events = await recentIntelligenceEvents(250);
  let event = events.find((row) => row.metadata?.purpose === 'household_liquidity_cash_benchmark');
  if (!event) {
    await refreshCashYieldBenchmark();
    events = await recentIntelligenceEvents(250);
    event = events.find((row) => row.metadata?.purpose === 'household_liquidity_cash_benchmark');
  }
  if (!event) {
    return {
      status: 'unavailable' as const,
      asOf: null,
      annualizedPercent: null,
      note: 'The short-term Treasury reference is unavailable right now. DAHCorp will not substitute a guessed rate.',
    };
  }
  const value = numberOrNull(event.metadata?.annualizedPercent);
  const date = typeof event.metadata?.observationDate === 'string'
    ? event.metadata.observationDate
    : event.occurredAt.slice(0, 10);
  return {
    status: value == null ? 'unavailable' as const : 'verified' as const,
    asOf: date,
    annualizedPercent: value,
    note: '3-month U.S. Treasury yield from FRED. This is a reference point, not a bank savings APY; taxes, access, settlement and product structure differ.',
  };
}

export default withErrorHandling('liquidity-rates', async (req: Request) => {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);
  const { response } = await requireSession(req);
  if (response) return response;

  let savings = await storedSavingsRateBenchmark();
  if (!savings) savings = await refreshSavingsRateBenchmark();

  return json({
    asOf: new Date().toISOString(),
    savings,
    treasury: await treasuryBenchmark(),
    note: 'These rates are evidence for a savings decision. DAHCorp does not assume the highest advertised APY is available to you until account eligibility and balance rules are confirmed.',
  });
});
