/**
 * Start of the current practice-clock calendar month (for "MTD" tiles). Pure.
 * Kept beside practiceDay.ts (owned by the scheduling work) so the two can be merged later.
 */
import { practiceToday, resolvePracticeTimeZone } from '@/lib/time/practiceTime';
import { practiceDayBounds } from './practiceDay';

export function practiceMonthStart(timeZone: string, now: Date = new Date()): Date {
  const today = practiceToday(resolvePracticeTimeZone(timeZone), now);
  return practiceDayBounds(`${today.slice(0, 8)}01`, timeZone).start;
}
