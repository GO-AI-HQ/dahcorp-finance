/** Shared chart styling. Kept in one place so every chart reads as one family. */
export const CHART = {
  gold: '#d4af37',
  gold2: '#f1cf69',
  ice: '#9ad7ff',
  positive: '#4ec98a',
  negative: '#e0625c',
  intel: '#b9a6ff',
  grid: 'rgba(255,255,255,0.08)',
  axis: 'rgba(255,255,255,0.48)',
  font: 11,
} as const;

export const AXIS_PROPS = {
  stroke: CHART.axis,
  tick: { fill: CHART.axis, fontSize: CHART.font },
  tickLine: false,
} as const;

/** "2026-08-27" → "Aug 27". Charts never show a full ISO string. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2026-08" → "Aug ’26". */
export function shortMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ’${String(y).slice(2)}`;
}
