/**
 * Practice-clock calendar days for server-side "today" / "this week" appointment queries.
 * The server runs in UTC, so new Date() midnight is UTC midnight (8 PM ET the evening before);
 * these bounds are midnight on the PRACTICE clock instead. Browser-safe (Intl only).
 */
import { fromPracticeWallTime, practiceToday, resolvePracticeTimeZone } from '@/lib/time/practiceTime';

/** "2026-10-19" + n days (calendar arithmetic, no zone). */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** [start, end) UTC instants of practice day `ymd` (end = next practice midnight; DST-safe). */
export function practiceDayBounds(ymd: string, timeZone: string): { start: Date; end: Date } {
  const tz = resolvePracticeTimeZone(timeZone);
  const start = fromPracticeWallTime(ymd, '00:00', tz);
  const end = fromPracticeWallTime(addDaysYmd(ymd, 1), '00:00', tz);
  if (!start || !end) throw new Error(`invalid practice day ${ymd}`);
  return { start, end };
}

/** Today's practice-day bounds. */
export function practiceTodayBounds(timeZone: string, now = new Date()): { ymd: string; start: Date; end: Date } {
  const ymd = practiceToday(resolvePracticeTimeZone(timeZone), now);
  return { ymd, ...practiceDayBounds(ymd, timeZone) };
}

/** "Mon" for a YYYY-MM-DD calendar date. */
export function weekdayOfYmd(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
