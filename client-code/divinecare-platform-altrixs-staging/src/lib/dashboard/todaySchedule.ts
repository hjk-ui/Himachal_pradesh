/**
 * Today's schedule for the role homes: row shape and counts. Pure (browser + server + tests).
 * The loader (homeData.ts) reads appointments whose start falls in today's PRACTICE-clock window
 * (practiceDay.ts) and hands the rows here; times are rendered on the practice clock.
 */
import type { AppointmentLabelChipData } from '@/lib/scheduling/appointmentLabels';
import { toPracticeWallTime } from '@/lib/time/practiceTime';

export type ScheduleStatus = 'scheduled' | 'checked-in' | 'in-session' | 'completed' | 'no-show' | 'late-cancel';

export const DB_TO_SCHEDULE_STATUS: Record<string, ScheduleStatus | null> = {
  SCHEDULED: 'scheduled',
  CHECKED_IN: 'checked-in',
  IN_SESSION: 'in-session',
  COMPLETED: 'completed',
  NO_SHOW: 'no-show',
  LATE_CANCEL: 'late-cancel',
  // Cancelled visits are not on the day's schedule
  CANCELLED: null,
};

export type ScheduleRow = {
  id: string;
  /** null for a protected record the viewer cannot open (no chart link) */
  clientId: string | null;
  clientName: string;
  protected: boolean;
  clinicianId: string | null;
  clinicianName: string | null;
  /** Visit type; hidden ("Protected appointment") for a locked record */
  type: string;
  /** HH:mm on the practice clock */
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  status: ScheduleStatus;
  isVirtual: boolean;
  locationId: string | null;
  locationName: string | null;
  /** true when the location is the client's home location (not recorded on the appointment) */
  locationInferred: boolean;
  label: AppointmentLabelChipData | null;
};

export type ScheduleCounts = {
  total: number;
  checkedIn: number;
  inSession: number;
  completed: number;
  noShow: number;
  lateCancel: number;
  /** Scheduled or checked in, not yet seen */
  remaining: number;
};

export type TodaySchedule = {
  date: string;
  timeZone: string;
  /** UTC instants of the practice-day window used for the query */
  windowStart: string;
  windowEnd: string;
  scope: 'caseload' | 'organization';
  locationId: string | null;
  /** false when a location was asked for but is not a Location of the organization */
  locationApplied: boolean;
  rows: ScheduleRow[];
  counts: ScheduleCounts;
};

export function scheduleCounts(rows: Pick<ScheduleRow, 'status'>[]): ScheduleCounts {
  const c: ScheduleCounts = { total: rows.length, checkedIn: 0, inSession: 0, completed: 0, noShow: 0, lateCancel: 0, remaining: 0 };
  for (const r of rows) {
    if (r.status === 'checked-in') c.checkedIn += 1;
    if (r.status === 'in-session') c.inSession += 1;
    if (r.status === 'completed') c.completed += 1;
    if (r.status === 'no-show') c.noShow += 1;
    if (r.status === 'late-cancel') c.lateCancel += 1;
    if (r.status === 'scheduled' || r.status === 'checked-in') c.remaining += 1;
  }
  return c;
}

export type RawScheduleAppointment = {
  id: string;
  clientId: string;
  clientName: string;
  /** SensitiveRecord alias when the client is a protected record */
  sensitiveAlias: string | null;
  isSensitive: boolean;
  /** Viewer may not open this protected record (42 CFR Part 2 / sensitive access) */
  locked: boolean;
  clinicianId: string | null;
  clinicianName: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  isVirtual: boolean;
  locationId: string | null;
  locationName: string | null;
  locationInferred: boolean;
  label: AppointmentLabelChipData | null;
};

export const PROTECTED_CLIENT_DISPLAY = 'Protected record';

/** One schedule row; null for a cancelled visit. Protected records show the alias only. */
export function toScheduleRow(a: RawScheduleAppointment, timeZone: string): ScheduleRow | null {
  const status = DB_TO_SCHEDULE_STATUS[a.status] ?? null;
  if (!status) return null;
  const hide = a.isSensitive;
  return {
    id: a.id,
    clientId: a.locked ? null : a.clientId,
    clientName: hide ? a.sensitiveAlias?.trim() || PROTECTED_CLIENT_DISPLAY : a.clientName,
    protected: hide,
    clinicianId: a.clinicianId,
    clinicianName: a.clinicianName,
    type: a.locked ? 'Protected appointment' : a.type,
    startTime: toPracticeWallTime(a.startsAt, timeZone).time,
    endTime: toPracticeWallTime(a.endsAt, timeZone).time,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status,
    isVirtual: a.isVirtual,
    locationId: a.locationId,
    locationName: a.locationName,
    locationInferred: a.locationInferred,
    label: a.locked ? null : a.label,
  };
}

export function buildScheduleRows(raw: RawScheduleAppointment[], timeZone: string): ScheduleRow[] {
  return raw
    .map((a) => toScheduleRow(a, timeZone))
    .filter((r): r is ScheduleRow => r !== null)
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt) || (x.clinicianName ?? '').localeCompare(y.clinicianName ?? '') || x.id.localeCompare(y.id));
}
