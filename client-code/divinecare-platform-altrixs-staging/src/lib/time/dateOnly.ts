/**
 * Calendar dates stored as 'YYYY-MM-DD' (date of birth, service date, appointment day).
 * Formatted with string arithmetic only: `new Date('2026-10-19')` is UTC midnight, which
 * shows as Oct 18 anywhere west of Greenwich. Nothing here touches Date or a time zone.
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type DateOnlyParts = { year: number; month: number; day: number };

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Strict 'YYYY-MM-DD' parse; null for anything else, including impossible dates like 2026-02-30. */
export function parseDateOnly(value: string | null | undefined): DateOnlyParts | null {
  const m = DATE_ONLY_RE.exec((value ?? '').trim());
  if (!m) return null;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** 0 = Sunday (Sakamoto's method, proleptic Gregorian). */
export function weekdayOfDateOnly({ year, month, day }: DateOnlyParts): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1] + day) % 7;
}

export type DateOnlyStyle = 'long' | 'medium' | 'weekday' | 'numeric';

/**
 * '2026-10-19' ->
 *   long:    "Monday, October 19, 2026"
 *   weekday: "Mon, Oct 19, 2026"
 *   medium:  "Oct 19, 2026" (default)
 *   numeric: "10/19/2026"
 * Invalid input is returned unchanged (empty input -> '').
 */
export function formatDateOnly(value: string | null | undefined, style: DateOnlyStyle = 'medium'): string {
  const parts = parseDateOnly(value);
  if (!parts) return (value ?? '').trim();
  const { year, month, day } = parts;
  const monthLong = MONTHS[month - 1];
  const monthShort = monthLong.slice(0, 3);
  switch (style) {
    case 'long':
      return `${WEEKDAYS[weekdayOfDateOnly(parts)]}, ${monthLong} ${day}, ${year}`;
    case 'weekday':
      return `${WEEKDAYS[weekdayOfDateOnly(parts)].slice(0, 3)}, ${monthShort} ${day}, ${year}`;
    case 'numeric':
      return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
    default:
      return `${monthShort} ${day}, ${year}`;
  }
}
