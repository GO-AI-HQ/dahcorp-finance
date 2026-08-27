import { describe, expect, it } from 'vitest';
import {
  WEEKS_PER_MONTH,
  WEEKS_PER_YEAR,
  annualisedVolatility,
  clamp,
  coefficientOfVariation,
  correlation,
  linearSlope,
  maxDrawdown,
  mean,
  median,
  round,
  rsi,
  safeDiv,
  simpleReturns,
  sma,
  stdev,
  sum,
} from '../src/core/math.js';

/**
 * The numeric primitives every financial figure in the app is built from.
 * They are tested first because a silent NaN or Infinity here would surface
 * later as a plausible-looking dollar amount.
 */
describe('constants', () => {
  it('derives weeks-per-month from 52/12 rather than approximating it', () => {
    expect(WEEKS_PER_YEAR).toBe(52);
    expect(WEEKS_PER_MONTH).toBe(52 / 12);
    // A weekly distribution annualised then divided by 12 must equal
    // weekly × WEEKS_PER_MONTH — the identity the self-buy engine relies on.
    expect((0.2 * WEEKS_PER_YEAR) / 12).toBeCloseTo(0.2 * WEEKS_PER_MONTH, 12);
  });
});

describe('safeDiv', () => {
  it('divides normally', () => {
    expect(safeDiv(10, 4)).toBe(2.5);
  });

  it('returns the fallback instead of Infinity or NaN', () => {
    expect(safeDiv(10, 0)).toBe(0);
    expect(safeDiv(10, 0, null as unknown as number)).toBeNull();
    expect(safeDiv(Number.NaN, 2)).toBe(0);
    expect(safeDiv(1, Number.POSITIVE_INFINITY, -1)).toBe(-1);
  });
});

describe('clamp', () => {
  it('bounds values and treats non-numbers as the minimum', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp(Number.NaN, 3, 9)).toBe(3);
  });
});

describe('sum, mean, median', () => {
  it('ignores non-finite entries', () => {
    expect(sum([1, 2, Number.NaN, 3])).toBe(6);
    expect(mean([1, 2, Number.NaN, 3])).toBe(2);
  });

  it('returns 0 rather than NaN for an empty series', () => {
    expect(sum([])).toBe(0);
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
  });

  it('averages the middle pair for an even-length series', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe('stdev and coefficientOfVariation', () => {
  it('is zero for a constant series', () => {
    expect(stdev([7, 7, 7, 7])).toBe(0);
    expect(coefficientOfVariation([7, 7, 7, 7])).toBe(0);
  });

  it('computes the population standard deviation', () => {
    // mean 5, squared deviations 4/1/0/1/4 → variance 2
    expect(stdev([3, 4, 5, 6, 7])).toBeCloseTo(Math.sqrt(2), 12);
    expect(coefficientOfVariation([3, 4, 5, 6, 7])).toBeCloseTo(Math.sqrt(2) / 5, 12);
  });

  it('needs at least two points', () => {
    expect(stdev([42])).toBe(0);
  });
});

describe('linearSlope', () => {
  it('is positive for a rising series and negative for a falling one', () => {
    expect(linearSlope([1, 2, 3, 4])).toBeCloseTo(1, 12);
    expect(linearSlope([4, 3, 2, 1])).toBeCloseTo(-1, 12);
  });

  it('is flat for a constant series and zero when undefined', () => {
    expect(linearSlope([2, 2, 2])).toBe(0);
    expect(linearSlope([2])).toBe(0);
  });
});

describe('correlation', () => {
  it('is 1 for identical series and -1 for mirrored series', () => {
    expect(correlation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 12);
    expect(correlation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
  });

  it('is 0 when a series has no variance or is too short to judge', () => {
    expect(correlation([1, 2, 3], [5, 5, 5])).toBe(0);
    expect(correlation([1, 2], [1, 2])).toBe(0);
  });

  it('aligns series from the most recent end when lengths differ', () => {
    expect(correlation([99, 99, 1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });
});

describe('simpleReturns', () => {
  it('produces one fewer value than the input', () => {
    expect(simpleReturns([10, 11, 22])).toEqual([0.10000000000000009, 1]);
  });

  it('skips non-positive prior prices instead of dividing by zero', () => {
    expect(simpleReturns([0, 5, 10])).toEqual([1]);
  });
});

describe('annualisedVolatility', () => {
  it('is zero for a flat series', () => {
    expect(annualisedVolatility([10, 10, 10, 10])).toBe(0);
  });

  it('scales daily deviation by the square root of trading days', () => {
    const closes = [100, 101, 100, 101, 100, 101];
    const daily = stdev(simpleReturns(closes));
    expect(annualisedVolatility(closes)).toBeCloseTo(daily * Math.sqrt(252), 12);
  });
});

describe('maxDrawdown', () => {
  it('measures the largest peak-to-trough decline as a positive fraction', () => {
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(0.5, 12);
  });

  it('is zero for a monotonically rising series', () => {
    expect(maxDrawdown([1, 2, 3])).toBe(0);
  });

  it('does not recover once a new peak is not reached', () => {
    // Peak 120 → trough 90 is 25%; the later 110 does not shrink the figure.
    expect(maxDrawdown([100, 120, 90, 110])).toBeCloseTo(0.25, 12);
  });
});

describe('sma', () => {
  it('averages only the final period', () => {
    expect(sma([1, 2, 3, 10, 20], 2)).toBe(15);
  });

  it('returns null rather than a partial average when history is short', () => {
    expect(sma([1, 2], 5)).toBeNull();
    expect(sma([1, 2], 0)).toBeNull();
  });
});

describe('rsi', () => {
  it('returns null when there is not enough history', () => {
    expect(rsi(Array.from({ length: 14 }, (_, i) => i + 1), 14)).toBeNull();
  });

  it('is 100 for an unbroken advance and 0 for an unbroken decline', () => {
    const up = Array.from({ length: 30 }, (_, i) => 10 + i);
    const down = Array.from({ length: 30 }, (_, i) => 40 - i);
    expect(rsi(up, 14)).toBe(100);
    expect(rsi(down, 14)).toBe(0);
  });

  it('is 50 for a flat series', () => {
    expect(rsi(Array.from({ length: 30 }, () => 10), 14)).toBe(50);
  });

  it('sits mid-range for an alternating series', () => {
    const zigzag = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 10 : 11));
    const value = rsi(zigzag, 14)!;
    expect(value).toBeGreaterThan(30);
    expect(value).toBeLessThan(70);
  });
});

describe('round', () => {
  it('rounds to the requested precision and never returns NaN', () => {
    expect(round(1.567, 2)).toBe(1.57);
    expect(round(2.34567, 4)).toBe(2.3457);
    expect(round(Number.NaN)).toBe(0);
  });
});
