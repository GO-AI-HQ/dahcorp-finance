import type { Config } from '@netlify/functions';
import { refreshIncomeIntelligence } from '../lib/incomeIntelligence.mts';
import { reserveFmpCall } from '../lib/fmpDailyBudget.mts';

/**
 * Daily read-only income research. FMP is intentionally not treated as an
 * intraday trading feed: one daily discovery pass is enough to refresh upcoming
 * distributions, dividend screens and candidate history while preserving API
 * headroom. No LLM or broker execution runs here.
 */
export default async () => {
  // The discovery pass makes three non-company FMP calls: one dividend calendar
  // and two screeners. Reserve them before the job starts so even duplicate
  // scheduled invocations cannot cross the persistent daily ceiling. Company
  // dividend-history calls reserve their own slots inside the FMP client.
  for (const purpose of ['income-calendar', 'income-stock-screen', 'income-etf-screen']) {
    const reservation = await reserveFmpCall(purpose);
    if (!reservation.reserved) {
      console.warn(`[dahcorp] income intelligence skipped: ${reservation.note}`);
      return;
    }
  }

  const { snapshot, persisted } = await refreshIncomeIntelligence();
  console.log(`[dahcorp] income intelligence: candidates=${snapshot.candidates.length} upcoming=${snapshot.upcoming.length} calls=${snapshot.callsUsed} persisted=${persisted}.`);
};

export const config: Config = {
  schedule: '11 7 * * *',
};