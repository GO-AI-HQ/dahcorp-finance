import { describe, expect, it } from 'vitest';
import { normalizeFmpDividendRows } from '../src/market/fmpDistributions.js';

describe('FMP distribution normalization', () => {
  it('uses real payment dates and ignores provider headline yield', () => {
    const rows = normalizeFmpDividendRows([
      {
        symbol: 'YMAG',
        date: '2026-08-21',
        recordDate: '2026-08-21',
        paymentDate: '2026-08-22',
        declarationDate: '2026-08-20',
        adjDividend: 0.105,
        dividend: 0.105,
        yield: 42.5,
        frequency: 'Weekly',
      },
    ], 'YMAG', '2026-08-31', 420);

    expect(rows).toEqual([{
      symbol: 'YMAG',
      exDate: '2026-08-21',
      payDate: '2026-08-22',
      amountPerShare: 0.105,
      kind: 'distribution',
      frequency: 'weekly',
      dataQuality: 'delayed',
    }]);
  });

  it('excludes future declared distributions from trailing-income math', () => {
    const rows = normalizeFmpDividendRows([
      { symbol: 'NVDY', date: '2026-08-28', paymentDate: '2026-08-29', dividend: 0.15, frequency: 'Weekly' },
      { symbol: 'NVDY', date: '2026-09-04', paymentDate: '2026-09-05', dividend: 0.16, frequency: 'Weekly' },
    ], 'NVDY', '2026-08-31', 420);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.exDate).toBe('2026-08-28');
  });

  it('prefers adjusted dividend and rejects invalid cash amounts', () => {
    const rows = normalizeFmpDividendRows([
      { symbol: 'YMAX', date: '2026-08-15', adjDividend: 0.09, dividend: 0.1, frequency: 'Weekly' },
      { symbol: 'YMAX', date: '2026-08-22', dividend: 0, frequency: 'Weekly' },
    ], 'YMAX', '2026-08-31', 420);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountPerShare).toBe(0.09);
  });
});
