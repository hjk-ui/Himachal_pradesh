import { addDaysYmd } from '@/lib/scheduling/slots';
import { fromPracticeWallTime, practiceToday } from '@/lib/time/practiceTime';

/**
 * Date window for GET /api/appointments. Before, the list loaded every appointment in the org
 * (about 2.3 s); now it is bounded:
 *   - date=YYYY-MM-DD             -> that practice day
 *   - from / to (YYYY-MM-DD)      -> those practice days, inclusive
 *   - neither, with clientId      -> no cap (the client chart shows the full history)
 *   - neither, no clientId        -> 90 days back through 365 days ahead
 * Days are PRACTICE calendar days (America/New_York by default), never the server's UTC day.
 * Browser-safe (no Prisma): the calendar uses the same defaults.
 */

export const DEFAULT_WINDOW_DAYS_BACK = 90;
export const DEFAULT_WINDOW_DAYS_AHEAD = 365;
/** Longest explicit range one request may ask for (about 3 years). */
export const MAX_WINDOW_DAYS = 3 * 366;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type ListWindowInput = { date?: string | null; from?: string | null; to?: string | null; clientId?: string | null };

export type ListWindow = {
  /** Inclusive first / last practice day. */
  from: string;
  to: string;
  /** [start, end) UTC instants. */
  start: Date;
  end: Date;
};

function dayCount(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

export function defaultListRange(timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const today = practiceToday(timeZone, now);
  return { from: addDaysYmd(today, -DEFAULT_WINDOW_DAYS_BACK), to: addDaysYmd(today, DEFAULT_WINDOW_DAYS_AHEAD) };
}

/**
 * The window to apply, null for "no cap" (clientId history), or an error for a bad range.
 */
export function appointmentListWindow(
  input: ListWindowInput,
  timeZone: string,
  now: Date = new Date()
): { ok: true; window: ListWindow | null } | { ok: false; error: string } {
  const date = input.date?.trim() || null;
  let from = input.from?.trim() || null;
  let to = input.to?.trim() || null;
  if (date) {
    if (!YMD.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD' };
    from = date;
    to = date;
  }
  if ((from && !YMD.test(from)) || (to && !YMD.test(to))) return { ok: false, error: 'from / to must be YYYY-MM-DD' };
  if (!from && !to) {
    if (input.clientId) return { ok: true, window: null };
    ({ from, to } = defaultListRange(timeZone, now));
  }
  const defaults = defaultListRange(timeZone, now);
  from = from ?? addDaysYmd(to!, -(DEFAULT_WINDOW_DAYS_BACK + DEFAULT_WINDOW_DAYS_AHEAD));
  to = to ?? (from > defaults.to ? addDaysYmd(from, DEFAULT_WINDOW_DAYS_AHEAD) : defaults.to);
  if (to < from) return { ok: false, error: 'to must be on or after from' };
  if (dayCount(from, to) > MAX_WINDOW_DAYS) return { ok: false, error: `Range is limited to ${MAX_WINDOW_DAYS} days` };
  const start = fromPracticeWallTime(from, '00:00', timeZone);
  const end = fromPracticeWallTime(addDaysYmd(to, 1), '00:00', timeZone);
  if (!start || !end) return { ok: false, error: 'Invalid date' };
  return { ok: true, window: { from, to, start, end } };
}
