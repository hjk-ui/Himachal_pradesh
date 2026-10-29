/**
 * US-dollar formatting for display. One formatter instance per variant (Intl is slow to construct).
 * formatUsd takes dollars; formatUsdCents takes integer cents (what Stripe and the ledger store).
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export type FormatUsdOptions = {
  /** Drop cents when the amount is a whole dollar ("$150" instead of "$150.00") */
  trimWholeDollars?: boolean;
  /** Text for null / undefined / non-numeric input (default an em dash) */
  fallback?: string;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 1234.5 -> "$1,234.50"; -20 -> "-$20.00"; null -> em dash. */
export function formatUsd(dollars: number | string | null | undefined, opts: FormatUsdOptions = {}): string {
  const n = toNumber(dollars);
  if (n === null) return opts.fallback ?? '—';
  // Round to cents first so float noise and -0.001 never print as "-$0.00"
  const cents = Math.round(n * 100);
  const value = cents / 100 || 0;
  if (opts.trimWholeDollars && cents % 100 === 0) return USD_WHOLE.format(value);
  return USD.format(value);
}

/** 123450 -> "$1,234.50". Cents are rounded to an integer first. */
export function formatUsdCents(cents: number | string | null | undefined, opts: FormatUsdOptions = {}): string {
  const n = toNumber(cents);
  if (n === null) return opts.fallback ?? '—';
  return formatUsd(Math.round(n) / 100, opts);
}
