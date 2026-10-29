/**
 * Practice time zone: the one wall clock appointments are booked and shown in.
 *
 * Appointment.startsAt / endsAt are UTC instants (Prisma `timestamp` columns hold UTC; the
 * server runs in UTC). Staff type and read times in the PRACTICE's zone (PracticeSettings.timeZone,
 * default America/New_York), never the server's zone and never the viewer's browser zone, so a
 * clinician travelling or working remotely sees the same 9:00 AM as the front desk.
 *
 * Browser-safe: Intl only, no Prisma. Server code gets the org's zone from practiceTimeServer.ts.
 */

export const DEFAULT_PRACTICE_TIME_ZONE = 'America/New_York';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
/** Trailing Z or ±hh:mm / ±hhmm offset. */
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/;

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolvePracticeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_PRACTICE_TIME_ZONE;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function zonedParts(at: Date, timeZone: string): Parts {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour % 24,
    minute: +p.minute,
    second: +p.second,
  };
}

/** Offset (ms) of `timeZone` from UTC at instant `at` (e.g. -4h for EDT). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const p = zonedParts(new Date(at), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * UTC instant for a wall-clock time in `timeZone`. DST: a time in the spring-forward gap
 * (2:30 AM on the March change day) moves forward by the gap (3:30 AM); an ambiguous fall-back
 * time (1:30 AM on the November change day) resolves to the first, daylight-time occurrence.
 */
export function zonedWallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE,
  s = 0
): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = zoneOffsetMs(wall, timeZone);
  let utc = wall - off1;
  const off2 = zoneOffsetMs(utc, timeZone);
  if (off2 !== off1) {
    const alt = wall - off2;
    // Prefer the candidate that maps back to the requested wall time; for the ambiguous hour
    // both do, take the earlier (daylight) one; for the gap neither does, keep the shifted one.
    const back = (t: number) => {
      const p = zonedParts(new Date(t), timeZone);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === wall;
    };
    if (back(alt) && back(utc)) utc = Math.min(alt, utc);
    else if (back(alt)) utc = alt;
    else utc = Math.max(alt, utc);
  }
  return new Date(utc);
}

/** "2026-10-19" + "09:44" read on the practice clock → UTC Date (null when malformed). */
export function fromPracticeWallTime(
  dateStr: string,
  timeStr: string,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): Date | null {
  const dm = DATE_RE.exec(dateStr?.trim() ?? '');
  const tm = TIME_RE.exec(timeStr?.trim() ?? '');
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi, s] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], tm[3] ? +tm[3] : 0];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const out = zonedWallTimeToUtc(y, mo, d, h, mi, resolvePracticeTimeZone(timeZone), s);
  // Reject roll-overs like 2026-02-31
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC instant → practice wall clock { date: 'YYYY-MM-DD', time: 'HH:mm' }. */
export function toPracticeWallTime(
  at: Date | string,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): { date: string; time: string } {
  const d = typeof at === 'string' ? new Date(at) : at;
  const p = zonedParts(d, resolvePracticeTimeZone(timeZone));
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Today's date on the practice clock (YYYY-MM-DD). */
export function practiceToday(timeZone: string = DEFAULT_PRACTICE_TIME_ZONE, now = new Date()): string {
  return toPracticeWallTime(now, timeZone).date;
}

export type ParsedAppointmentDateTime = { at: Date; naive: boolean };

/**
 * Parse a datetime from a client. With an offset ("…Z", "…-04:00") it is an instant and is used
 * as is. Without one ("2026-10-19T09:44") it is a practice wall-clock time, NOT UTC: reading it
 * as UTC is what stored 9:44 AM ET as 5:44 AM ET. `naive: true` lets the caller log it.
 */
export function parseAppointmentDateTime(
  raw: string,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE
): ParsedAppointmentDateTime | null {
  const s = raw?.trim();
  if (!s) return null;
  if (OFFSET_RE.test(s) && /^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const at = new Date(s);
    return Number.isNaN(at.getTime()) ? null : { at, naive: false };
  }
  const m = NAIVE_DATETIME_RE.exec(s);
  if (!m) return null;
  const at = fromPracticeWallTime(m[1], m[2], timeZone);
  return at ? { at, naive: true } : null;
}

const ZONE_LABELS: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Detroit': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PT',
  'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
  'America/Puerto_Rico': 'AST',
};

/** Short label shown next to times ("ET"). */
export function practiceZoneLabel(timeZone: string = DEFAULT_PRACTICE_TIME_ZONE): string {
  const tz = resolvePracticeTimeZone(timeZone);
  if (ZONE_LABELS[tz]) return ZONE_LABELS[tz];
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    return part?.value || tz;
  } catch {
    return tz;
  }
}

function asDate(at: Date | string | number): Date | null {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "9:44 AM" on the practice clock. */
export function formatPracticeTime(
  at: Date | string | number,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE,
  opts: { withZone?: boolean } = {}
): string {
  const d = asDate(at);
  if (!d) return '';
  const tz = resolvePracticeTimeZone(timeZone);
  const t = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return opts.withZone ? `${t} ${practiceZoneLabel(tz)}` : t;
}

/** "Mon, Oct 19, 2026" (override with Intl options) on the practice clock. */
export function formatPracticeDate(
  at: Date | string | number,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE,
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
): string {
  const d = asDate(at);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { ...opts, timeZone: resolvePracticeTimeZone(timeZone) });
}

/** "Mon, Oct 19, 2026, 9:44 AM ET". */
export function formatPracticeDateTime(
  at: Date | string | number,
  timeZone: string = DEFAULT_PRACTICE_TIME_ZONE,
  opts: { withZone?: boolean; dateOpts?: Intl.DateTimeFormatOptions } = {}
): string {
  const d = asDate(at);
  if (!d) return '';
  const date = formatPracticeDate(d, timeZone, opts.dateOpts);
  return `${date}, ${formatPracticeTime(d, timeZone, { withZone: opts.withZone ?? true })}`;
}

/** "09:44" → "9:44 AM" for an already-practice-time HH:mm string (no zone math). */
export function formatWallClock(hhmm: string): string {
  const m = TIME_RE.exec(hhmm || '');
  if (!m) return hhmm || '';
  const h = +m[1];
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}
