/**
 * Scheduler date navigation on PRACTICE calendar days (YYYY-MM-DD strings, no browser zone):
 * Monday-first weeks, a 6-week month grid, and prev / next by day, week or month.
 */
import { addDaysYmd } from '@/lib/scheduling/slots';

export type CalMode = 'day' | 'week' | 'month';
export const CAL_MODES: readonly CalMode[] = ['day', 'week', 'month'] as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v: string | null | undefined): v is string => Boolean(v && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)));

/** 0 = Sunday .. 6 = Saturday, for a calendar date (no time zone involved). */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function mondayOf(ymd: string): string {
  const day = weekdayOf(ymd);
  return addDaysYmd(ymd, day === 0 ? -6 : 1 - day);
}

export function weekDates(ymd: string): string[] {
  const monday = mondayOf(ymd);
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
}

/** Monday-first weeks covering the whole month of `ymd` (4 to 6 rows). */
export function monthGrid(ymd: string): string[][] {
  const first = `${ymd.slice(0, 7)}-01`;
  const month = ymd.slice(0, 7);
  const weeks: string[][] = [];
  let start = mondayOf(first);
  while (weeks.length < 6) {
    const week = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
    if (weeks.length > 0 && week[0].slice(0, 7) !== month) break;
    weeks.push(week);
    start = addDaysYmd(start, 7);
  }
  return weeks;
}

/** First and last day the view shows (inclusive). */
export function visibleDates(ymd: string, mode: CalMode): { from: string; to: string } {
  if (mode === 'day') return { from: ymd, to: ymd };
  if (mode === 'week') {
    const days = weekDates(ymd);
    return { from: days[0], to: days[6] };
  }
  const grid = monthGrid(ymd);
  return { from: grid[0][0], to: grid[grid.length - 1][6] };
}

/** Previous / next day, week or month. Month steps keep the day, clamped to the month's length. */
export function shiftDate(ymd: string, mode: CalMode, step: number): string {
  if (mode === 'day') return addDaysYmd(ymd, step);
  if (mode === 'week') return addDaysYmd(ymd, step * 7);
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + step, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
