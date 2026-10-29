import { addDaysYmd, weekdayKey } from '@/lib/scheduling/slots';
import { fromPracticeWallTime } from '@/lib/time/practiceTime';

/**
 * Recurring appointment rules (AppointmentSeries). Browser-safe (no Prisma): the booking form
 * previews the same dates the server books.
 *
 *   weekly    every `interval` weeks (1-4) on byWeekday (default: the start date's weekday)
 *   biweekly  every 2 x `interval` weeks
 *   monthly   every `interval` months (1-3) on the start date's day of month; a day the month
 *             does not have (the 31st in November) moves to that month's last day
 *
 * Bounded: an end date OR a count is required; never more than 26 occurrences and never past
 * 6 months from the start date. Each occurrence is the same PRACTICE wall-clock time
 * (fromPracticeWallTime), so a 9:00 AM weekly visit stays 9:00 AM across the DST changes.
 */

export const SERIES_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type SeriesFrequency = (typeof SERIES_FREQUENCIES)[number];

export const MAX_SERIES_OCCURRENCES = 26;
export const MAX_SERIES_MONTHS = 6;

export type RecurrenceRule = {
  frequency: SeriesFrequency;
  interval?: number | null;
  /** 0 = Sunday .. 6 = Saturday (weekly / biweekly) */
  byWeekday?: number[] | null;
  /** YYYY-MM-DD practice date of the first occurrence (or the first day to consider) */
  startDate: string;
  endDate?: string | null;
  count?: number | null;
  /** HH:mm practice wall clock */
  startTime: string;
  durationMinutes: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function weekdayIndex(ymd: string): number {
  return WEEKDAY_INDEX[weekdayKey(ymd)];
}

function daysInMonth(y: number, m1: number) {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

/** Same day-of-month `months` later, clamped to the month's last day. */
export function addMonthsYmd(ymd: string, months: number, dayOfMonth?: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(dayOfMonth ?? d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Last allowed practice date: the day before start + 6 months. */
export function seriesHardEnd(startDate: string): string {
  return addDaysYmd(addMonthsYmd(startDate, MAX_SERIES_MONTHS), -1);
}

export function validateRecurrence(rule: RecurrenceRule): string | null {
  if (!SERIES_FREQUENCIES.includes(rule.frequency)) return 'Repeat must be weekly, every 2 weeks, or monthly';
  if (!YMD.test(rule.startDate) || !fromPracticeWallTime(rule.startDate, '12:00')) return 'Start date is not valid';
  if (!HM.test(rule.startTime)) return 'Start time must be HH:mm';
  if (!Number.isInteger(rule.durationMinutes) || rule.durationMinutes < 5 || rule.durationMinutes > 480) {
    return 'Duration must be 5 to 480 minutes';
  }
  const interval = rule.interval ?? 1;
  const maxInterval = rule.frequency === 'monthly' ? 3 : 4;
  if (!Number.isInteger(interval) || interval < 1 || interval > maxInterval) return `Interval must be 1 to ${maxInterval}`;
  if (rule.byWeekday?.length) {
    if (rule.frequency === 'monthly') return 'Weekdays apply to weekly repeats only';
    if (!rule.byWeekday.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return 'Weekdays must be 0 (Sun) to 6 (Sat)';
  }
  const hasEnd = Boolean(rule.endDate);
  const hasCount = rule.count != null;
  if (!hasEnd && !hasCount) return 'Choose an end date or a number of visits';
  if (hasCount && (!Number.isInteger(rule.count) || rule.count! < 1 || rule.count! > MAX_SERIES_OCCURRENCES)) {
    return `Number of visits must be 1 to ${MAX_SERIES_OCCURRENCES}`;
  }
  if (hasEnd) {
    if (!YMD.test(rule.endDate!)) return 'End date is not valid';
    if (rule.endDate! < rule.startDate) return 'End date must be on or after the start date';
    if (rule.endDate! > seriesHardEnd(rule.startDate)) return `A series can run at most ${MAX_SERIES_MONTHS} months`;
  }
  return null;
}

/** Practice dates of the occurrences (YYYY-MM-DD), in order. Assumes a valid rule. */
export function occurrenceDates(rule: RecurrenceRule): string[] {
  const interval = rule.interval ?? 1;
  const limit = Math.min(rule.count ?? MAX_SERIES_OCCURRENCES, MAX_SERIES_OCCURRENCES);
  const hardEnd = seriesHardEnd(rule.startDate);
  const end = rule.endDate && rule.endDate < hardEnd ? rule.endDate : hardEnd;
  const out: string[] = [];

  if (rule.frequency === 'monthly') {
    const dom = Number(rule.startDate.slice(8, 10));
    for (let k = 0; out.length < limit; k++) {
      const date = addMonthsYmd(rule.startDate, k * interval, dom);
      if (date > end) break;
      out.push(date);
    }
    return out;
  }

  const stepWeeks = (rule.frequency === 'biweekly' ? 2 : 1) * interval;
  const days = Array.from(new Set(rule.byWeekday?.length ? rule.byWeekday : [weekdayIndex(rule.startDate)])).sort((a, b) => a - b);
  const weekStart = addDaysYmd(rule.startDate, -weekdayIndex(rule.startDate)); // Sunday of the start week
  for (let w = 0; out.length < limit && w < 60; w += stepWeeks) {
    for (const d of days) {
      const date = addDaysYmd(weekStart, w * 7 + d);
      if (date < rule.startDate) continue;
      if (date > end) return out;
      out.push(date);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export type Occurrence = { date: string; start: Date; end: Date };

/** Occurrence instants on the practice clock (DST-safe). */
export function occurrenceInstants(rule: RecurrenceRule, timeZone: string): Occurrence[] {
  return occurrenceDates(rule)
    .map((date) => {
      const start = fromPracticeWallTime(date, rule.startTime, timeZone);
      return start ? { date, start, end: new Date(start.getTime() + rule.durationMinutes * 60_000) } : null;
    })
    .filter((o): o is Occurrence => Boolean(o));
}

/** Human label for the booking form ("Every 2 weeks on Mon, Wed"). */
export function describeRecurrence(rule: Pick<RecurrenceRule, 'frequency' | 'interval' | 'byWeekday' | 'startDate'>): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const interval = rule.interval ?? 1;
  if (rule.frequency === 'monthly') {
    const dom = Number(rule.startDate.slice(8, 10));
    return `${interval === 1 ? 'Monthly' : `Every ${interval} months`} on day ${dom}`;
  }
  const weeks = (rule.frequency === 'biweekly' ? 2 : 1) * interval;
  const days = (rule.byWeekday?.length ? rule.byWeekday : [weekdayIndex(rule.startDate)]).map((d) => names[d]).join(', ');
  return `${weeks === 1 ? 'Weekly' : `Every ${weeks} weeks`} on ${days}`;
}
