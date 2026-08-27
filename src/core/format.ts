/** Presentation formatters. UI-only — never used inside calculations. */

const usd = (min: number, max: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: min, maximumFractionDigits: max });

const money2 = usd(2, 2);
const money0 = usd(0, 0);
const money4 = usd(4, 4);

export function formatMoney(value: number | null | undefined, dp: 0 | 2 | 4 = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (dp === 0) return money0.format(value);
  if (dp === 4) return money4.format(value);
  return money2.format(value);
}

/** Compact money for large hero numbers: $15.8k, $1.24M. */
export function formatMoneyCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000).toFixed(1)}k`;
  return formatMoney(value, abs < 100 ? 2 : 0);
}

/** `value` is a fraction (0.0382 → "3.82%"). */
export function formatPct(value: number | null | undefined, dp = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(dp)}%`;
}

export function formatSignedPct(value: number | null | undefined, dp = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(dp)}%`;
}

export function formatSignedMoney(value: number | null | undefined, dp: 0 | 2 = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatMoney(value, dp)}`;
}

export function formatShares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const dp = Math.abs(value) >= 1000 ? 0 : Math.abs(value) % 1 === 0 ? 0 : 4;
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function formatNumber(value: number | null | undefined, dp = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Months → "14 mo" / "2 yr 3 mo". */
export function formatMonths(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return '—';
  if (months < 0) return '—';
  if (months < 24) return `${Math.round(months)} mo`;
  const yrs = Math.floor(months / 12);
  const rem = Math.round(months - yrs * 12);
  return rem === 0 ? `${yrs} yr` : `${yrs} yr ${rem} mo`;
}
