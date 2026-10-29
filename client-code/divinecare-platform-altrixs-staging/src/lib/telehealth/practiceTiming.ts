/**
 * Telehealth date/time on the PRACTICE clock (pure; no Prisma).
 *
 * The server runs in UTC. Two storage shapes exist:
 * - Appointment.startsAt / endsAt: real UTC instants -> show via toPracticeWallTime.
 * - TelehealthSession.sessionDate + startTime: the practice wall DATE stored as 12:00 UTC of
 *   that calendar day, plus an "HH:mm" practice wall time string. The date is read back with
 *   UTC getters (never local getters, never zone conversion).
 */
import {
  DEFAULT_PRACTICE_TIME_ZONE,
  formatWallClock,
  fromPracticeWallTime,
  practiceToday,
  practiceZoneLabel,
  toPracticeWallTime,
} from '@/lib/time/practiceTime';

/** TelehealthSession.sessionDate column value for a practice wall date (YYYY-MM-DD). */
export function sessionDateValue(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

/** Practice wall date (YYYY-MM-DD) held in a TelehealthSession.sessionDate column. */
export function sessionDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Practice wall date + HH:mm of an Appointment instant. */
export function appointmentWallTime(at: Date, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE) {
  const w = toPracticeWallTime(at, timeZone);
  return { sessionDate: w.date, startTime: w.time };
}

export type PracticeRange = {
  /** Bounds for TelehealthSession.sessionDate (calendar days stored at 12:00 UTC). */
  sessionStart: Date;
  sessionEnd: Date;
  /** Bounds for Appointment.startsAt (practice midnight .. next practice midnight - 1 ms). */
  apptStart: Date;
  apptEnd: Date;
};

/** Range covering practice days firstYmd..lastYmd inclusive. */
export function practiceRange(
  firstYmd: string,
  lastYmd: string,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): PracticeRange {
  const apptStart = fromPracticeWallTime(firstYmd, '00:00', timeZone);
  const nextMidnight = fromPracticeWallTime(addDaysYmd(lastYmd, 1), '00:00', timeZone);
  if (!apptStart || !nextMidnight) throw new Error('Invalid practice date');
  return {
    sessionStart: new Date(`${firstYmd}T00:00:00.000Z`),
    sessionEnd: new Date(`${lastYmd}T23:59:59.999Z`),
    apptStart,
    apptEnd: new Date(nextMidnight.getTime() - 1),
  };
}

/** Today on the practice clock. */
export function practiceDayRange(timeZone: string = DEFAULT_PRACTICE_TIME_ZONE, now = new Date()) {
  const today = practiceToday(timeZone, now);
  return { today, ...practiceRange(today, today, timeZone) };
}

/** Monday..Sunday practice week containing `now`. */
export function practiceWeekRange(timeZone: string = DEFAULT_PRACTICE_TIME_ZONE, now = new Date()) {
  const today = practiceToday(timeZone, now);
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const monday = addDaysYmd(today, dow === 0 ? -6 : 1 - dow);
  return practiceRange(monday, addDaysYmd(monday, 6), timeZone);
}

/**
 * Patient-facing "Today" / "Oct 19, 2026" and "9:00 AM ET" for a practice wall date + HH:mm.
 * "Today" compares against today on the practice clock, not the server's UTC date.
 */
export function formatSessionTiming(
  dateYmd: string,
  timeStr: string,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE,
  now = new Date()
) {
  const formattedTime = `${formatWallClock(timeStr)} ${practiceZoneLabel(timeZone)}`;
  const isToday = dateYmd === practiceToday(timeZone, now);
  const d = new Date(`${dateYmd}T12:00:00Z`);
  const formattedDate = isToday
    ? 'Today'
    : Number.isNaN(d.getTime())
      ? String(dateYmd)
      : d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });
  return { formattedDate, formattedTime, isToday };
}
