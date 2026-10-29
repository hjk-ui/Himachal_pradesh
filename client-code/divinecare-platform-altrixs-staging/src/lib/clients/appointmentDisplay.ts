/**
 * Staff-facing appointment date/time labels (client chart, banner, home dashboards).
 *
 * Appointment.startsAt is a UTC instant. It is always shown on the PRACTICE clock (never the
 * server's UTC clock or the viewer's browser zone), with a short zone label ("ET"). Browser-safe.
 */
import {
  DEFAULT_PRACTICE_TIME_ZONE,
  formatPracticeDate,
  formatPracticeTime,
  fromPracticeWallTime,
  resolvePracticeTimeZone,
} from '@/lib/time/practiceTime';

export type ApptWhenInput = {
  startsAt?: string | Date | null;
  /** Practice-clock date / time from the appointments API (YYYY-MM-DD / HH:mm). */
  date?: string | null;
  startTime?: string | null;
  timeZone?: string | null;
};

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

/** The UTC instant: startsAt when valid, else the practice wall-clock date + startTime. */
export function apptInstant(a: ApptWhenInput): Date | null {
  const tz = resolvePracticeTimeZone(a.timeZone);
  if (a.startsAt) {
    const d = a.startsAt instanceof Date ? a.startsAt : new Date(a.startsAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (a.date && a.startTime) return fromPracticeWallTime(a.date, a.startTime, tz);
  return null;
}

/** "Mon, Oct 19, 9:00 AM ET" on the practice clock. */
export function formatApptWhenStaff(
  a: ApptWhenInput,
  opts: { dateOpts?: Intl.DateTimeFormatOptions; withZone?: boolean } = {}
): string {
  const tz = resolvePracticeTimeZone(a.timeZone ?? DEFAULT_PRACTICE_TIME_ZONE);
  const at = apptInstant(a);
  if (!at) return [a.date, a.startTime].filter(Boolean).join(' · ');
  const date = formatPracticeDate(at, tz, opts.dateOpts ?? DEFAULT_DATE_OPTS);
  return `${date}, ${formatPracticeTime(at, tz, { withZone: opts.withZone ?? true })}`;
}
