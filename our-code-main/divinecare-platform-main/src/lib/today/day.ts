import { addCalendarDays, clinicDate } from '@/lib/workflows/dates';

/** Practice time zone — same default as clinicDate(). */
export const PRACTICE_TIME_ZONE = 'America/New_York';

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - at.getTime();
}

/** UTC instant at which `day` (YYYY-MM-DD) begins in `timeZone`. */
export function practiceDayStart(day: string, timeZone = PRACTICE_TIME_ZONE): Date {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Two passes handle DST transitions around local midnight.
  let guess = naive - zoneOffsetMs(new Date(naive), timeZone);
  guess = naive - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export type PracticeDayRange = { day: string; start: Date; end: Date };

export function practiceDayRange(now = new Date(), timeZone = PRACTICE_TIME_ZONE): PracticeDayRange {
  const day = clinicDate(now, timeZone);
  return {
    day,
    start: practiceDayStart(day, timeZone),
    end: practiceDayStart(addCalendarDays(day, 1), timeZone),
  };
}
