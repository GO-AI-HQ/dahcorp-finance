import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  monthsBetween,
  parseISODate,
  toISODate,
  withinTrailingDays,
} from '../src/core/dates.js';

/**
 * Every window in the app (trailing 4/13/26/52 weeks, 30-day income, goal
 * horizons) is built on these helpers, so an off-by-one here would silently
 * change reported income.
 */
describe('parseISODate', () => {
  it('anchors at midday UTC so no timezone can shift the calendar day', () => {
    expect(parseISODate('2026-06-30').toISOString()).toBe('2026-06-30T12:00:00.000Z');
    expect(toISODate(parseISODate('2026-06-30'))).toBe('2026-06-30');
  });

  it('tolerates a full timestamp by using the date portion', () => {
    expect(toISODate(parseISODate('2026-06-30T23:45:00Z'))).toBe('2026-06-30');
  });
});

describe('addDays', () => {
  it('moves forward and backward across month and year boundaries', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-06-30', 0)).toBe('2026-06-30');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('steps back a full 52-week distribution history without drift', () => {
    expect(addDays('2026-06-30', -7 * 52)).toBe('2025-07-01');
    expect(daysBetween('2025-07-01', '2026-06-30')).toBe(364);
  });
});

describe('addMonths', () => {
  it('advances the month for projection horizons', () => {
    expect(addMonths('2026-06-30', 1)).toBe('2026-07-30');
    expect(addMonths('2026-06-30', 12)).toBe('2027-06-30');
    expect(addMonths('2026-06-30', -6)).toBe('2025-12-30');
  });

  it('rolls over when the target month is shorter', () => {
    // JS Date semantics: Jan 31 + 1 month overflows into March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-03-03');
  });
});

describe('daysBetween', () => {
  it('is signed and symmetric', () => {
    expect(daysBetween('2026-06-01', '2026-06-30')).toBe(29);
    expect(daysBetween('2026-06-30', '2026-06-01')).toBe(-29);
    expect(daysBetween('2026-06-30', '2026-06-30')).toBe(0);
  });
});

describe('monthsBetween', () => {
  it('counts whole months only', () => {
    expect(monthsBetween('2026-01-15', '2026-06-15')).toBe(5);
    expect(monthsBetween('2026-01-15', '2026-06-14')).toBe(4);
    expect(monthsBetween('2025-06-30', '2026-06-30')).toBe(12);
  });
});

describe('withinTrailingDays', () => {
  const asOf = '2026-06-30';

  it('includes today and excludes the far edge of the window', () => {
    expect(withinTrailingDays(asOf, asOf, 7)).toBe(true);
    expect(withinTrailingDays(addDays(asOf, -6), asOf, 7)).toBe(true);
    expect(withinTrailingDays(addDays(asOf, -7), asOf, 7)).toBe(false);
  });

  it('excludes future-dated items so an announced payment is not counted early', () => {
    expect(withinTrailingDays(addDays(asOf, 1), asOf, 7)).toBe(false);
  });

  it('captures exactly 52 weekly payments in a 364-day window', () => {
    const payDates = Array.from({ length: 60 }, (_, i) => addDays(asOf, -1 - i * 7));
    const counted = payDates.filter((d) => withinTrailingDays(d, asOf, 364));
    expect(counted).toHaveLength(52);
  });
});
