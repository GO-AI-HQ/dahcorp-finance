import type { DistributionEvent, DistributionFrequency } from '../core/types.js';

export interface FmpDividendRow {
  symbol?: string | null;
  date?: string | null;
  recordDate?: string | null;
  paymentDate?: string | null;
  declarationDate?: string | null;
  adjDividend?: number | null;
  dividend?: number | null;
  yield?: number | null;
  frequency?: string | null;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function normalizeFmpFrequency(value: unknown): DistributionFrequency {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text.includes('week')) return 'weekly';
  if (text.includes('month')) return 'monthly';
  if (text.includes('quarter')) return 'quarterly';
  if (text.includes('semi') || text.includes('half')) return 'semiannual';
  if (text.includes('annual') || text.includes('year')) return 'annual';
  return 'irregular';
}

/**
 * Normalize FMP's company-dividend rows into the same deterministic contract
 * used by the rest of DAHCorp Finance.
 *
 * The provider-supplied `yield` is intentionally ignored. Variable weekly and
 * monthly funds can make one-payment yield figures look like an annual rate.
 * DAHCorp continues to calculate its own trailing and modeled rates from the
 * actual cash distributions and current market price.
 */
export function normalizeFmpDividendRows(
  rows: FmpDividendRow[],
  requestedSymbol: string,
  asOf: string,
  days: number,
): DistributionEvent[] {
  const symbol = requestedSymbol.toUpperCase();
  const endMs = Date.parse(`${asOf}T23:59:59Z`);
  const startMs = endMs - Math.max(1, days) * 86_400_000;

  return rows
    .map((row): DistributionEvent | null => {
      const exDate = isoDate(row.date);
      const payDate = isoDate(row.paymentDate) ?? exDate;
      const amount = finitePositive(row.adjDividend) ?? finitePositive(row.dividend);
      const rowSymbol = (row.symbol ?? symbol).toUpperCase();
      if (!exDate || !payDate || amount == null || rowSymbol !== symbol) return null;
      const exMs = Date.parse(`${exDate}T12:00:00Z`);
      // Announced future distributions are useful event intelligence, but they
      // must not enter trailing-income math before the ex-date occurs.
      if (!Number.isFinite(exMs) || exMs > endMs || exMs < startMs) return null;
      return {
        symbol,
        exDate,
        payDate,
        amountPerShare: amount,
        kind: 'distribution',
        frequency: normalizeFmpFrequency(row.frequency),
        dataQuality: 'delayed',
      };
    })
    .filter((row): row is DistributionEvent => row != null)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
}
