/** Date helpers. All functions take an explicit reference date so results are
 * reproducible in tests and in server functions. */

export const MS_PER_DAY = 86_400_000;

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(iso: string): Date {
  // Anchor to midday UTC so DST/offset arithmetic never shifts the calendar day.
  return new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseISODate(iso).getTime() + days * MS_PER_DAY));
}

export function addMonths(iso: string, months: number): string {
  const d = parseISODate(iso);
  const target = new Date(d);
  target.setUTCMonth(target.getUTCMonth() + months);
  return toISODate(target);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseISODate(toISO).getTime() - parseISODate(fromISO).getTime()) / MS_PER_DAY);
}

/** Whole months between two dates, rounded down. */
export function monthsBetween(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

/** Inclusive-of-today window filter: keeps items within the last `days`. */
export function withinTrailingDays(itemISO: string, asOfISO: string, days: number): boolean {
  const delta = daysBetween(itemISO, asOfISO);
  return delta >= 0 && delta < days;
}

export function formatMonthLabel(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
