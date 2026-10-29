/**
 * One-time copy of the legacy group blob (ClinicModuleState module 'group-sessions') into the
 * relational group tables. Pure planning step (no DB): scripts/migrate-group-sessions-blob.ts loads
 * the blob and the org's clients / staff, calls planBlobMigration(), prints the counts, and writes
 * only with --apply.
 *
 * Never fabricates:
 *   - a member is copied only when its clientId is a client of the same organization;
 *   - a facilitator is linked only when the free-text name matches exactly one active staff user;
 *   - legacy attendance marks and note text were stored on the GROUP, not on a dated session. They
 *     are attached only when the group has exactly one occurrence (unambiguous), as an unsigned
 *     draft (shared section + per-member text), never as a signed progress note or a claim;
 *     otherwise they are left in the blob and counted as not migrated;
 *   - nothing is invented for missing dates, times or durations (the row is skipped and counted).
 */
import { defaultBilling } from './types';

export type LegacyGroup = {
  id?: unknown;
  name?: unknown;
  groupType?: unknown;
  description?: unknown;
  facilitator?: unknown;
  location?: unknown;
  mode?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  recurrence?: { frequency?: unknown; days?: unknown; startTime?: unknown; duration?: unknown } | null;
  capacity?: unknown;
  active?: unknown;
  occurrences?: { id?: unknown; date?: unknown; startTime?: unknown; duration?: unknown; status?: unknown }[] | null;
  members?: {
    id?: unknown;
    clientId?: unknown;
    membershipStatus?: unknown;
    membershipStart?: unknown;
    membershipEnd?: unknown;
    attendance?: unknown;
    individualNote?: unknown;
  }[] | null;
  note?: { status?: unknown; commonText?: unknown; individualized?: Record<string, unknown> | null } | null;
};

export type PlannedMember = { clientId: string; status: 'active' | 'inactive'; joinedOn: string; leftOn: string | null };
export type PlannedSession = { legacyId: string; date: string; startTime: string; durationMinutes: number; status: 'scheduled' | 'completed' | 'cancelled' };
export type PlannedAttendance = { clientId: string; status: 'present' | 'late' | 'absent' | 'excused'; legacyNoteText: string | null };

export type PlannedGroup = {
  legacyId: string;
  name: string;
  kind: 'psychotherapy';
  groupType: 'therapy' | 'prp';
  description: string | null;
  facilitatorId: string | null;
  room: string | null;
  telehealth: boolean;
  capacity: number;
  defaultDurationMinutes: number;
  billingCode: string | null;
  billingMode: 'per_session' | 'attendance_only';
  status: 'active' | 'archived';
  recurFrequency: 'weekly' | 'biweekly' | null;
  recurWeekdays: number[];
  recurStartTime: string | null;
  recurStartDate: string | null;
  recurEndDate: string | null;
  members: PlannedMember[];
  sessions: PlannedSession[];
  /** Only when exactly one session exists: attached to it as an unsigned draft */
  draft: { sessionLegacyId: string; sharedText: string | null; attendance: PlannedAttendance[] } | null;
};

export type MigrationCounts = {
  groupsInBlob: number;
  groupsPlanned: number;
  groupsAlreadyMigrated: number;
  groupsSkippedInvalid: number;
  membersPlanned: number;
  membersSkippedUnknownClient: number;
  sessionsPlanned: number;
  sessionsSkippedInvalid: number;
  facilitatorsMatched: number;
  facilitatorsUnmatched: number;
  draftsAttached: number;
  attendanceMarksAttached: number;
  attendanceMarksNotMigrated: number;
  noteTextsNotMigrated: number;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

function legacyAttendance(v: unknown): PlannedAttendance['status'] | null {
  const s = str(v).toLowerCase();
  if (s === 'present' || s === 'late' || s === 'absent' || s === 'excused') return s;
  return null;
}

export function emptyCounts(): MigrationCounts {
  return {
    groupsInBlob: 0, groupsPlanned: 0, groupsAlreadyMigrated: 0, groupsSkippedInvalid: 0,
    membersPlanned: 0, membersSkippedUnknownClient: 0, sessionsPlanned: 0, sessionsSkippedInvalid: 0,
    facilitatorsMatched: 0, facilitatorsUnmatched: 0, draftsAttached: 0, attendanceMarksAttached: 0,
    attendanceMarksNotMigrated: 0, noteTextsNotMigrated: 0,
  };
}

export function planBlobMigration(
  blob: unknown,
  ctx: {
    /** Client ids of the organization */
    clientIds: Set<string>;
    /** lower-cased staff name -> user ids (active staff of the organization) */
    staffByName: Map<string, string[]>;
    /** legacySourceId values already in clinical_groups for this org */
    alreadyMigrated: Set<string>;
  }
): { groups: PlannedGroup[]; counts: MigrationCounts } {
  const counts = emptyCounts();
  const list = Array.isArray(blob) ? (blob as LegacyGroup[]) : [];
  counts.groupsInBlob = list.length;
  const groups: PlannedGroup[] = [];
  for (const raw of list) {
    const legacyId = str(raw?.id);
    const name = str(raw?.name);
    if (!legacyId || !name) {
      counts.groupsSkippedInvalid++;
      continue;
    }
    if (ctx.alreadyMigrated.has(legacyId)) {
      counts.groupsAlreadyMigrated++;
      continue;
    }
    const groupType = str(raw.groupType) === 'PRP' ? 'prp' : 'therapy';
    const billing = defaultBilling('psychotherapy', groupType);
    const facName = str(raw.facilitator).toLowerCase();
    const facMatches = facName ? ctx.staffByName.get(facName) ?? [] : [];
    const facilitatorId = facMatches.length === 1 ? facMatches[0] : null;
    if (facilitatorId) counts.facilitatorsMatched++;
    else if (facName) counts.facilitatorsUnmatched++;
    const rec = raw.recurrence ?? null;
    const freq = str(rec?.frequency).toLowerCase();
    const weekdays = (Array.isArray(rec?.days) ? (rec!.days as unknown[]) : [])
      .map((d) => DAYS[str(d).toLowerCase()])
      .filter((d): d is number => d !== undefined);
    const startTime = HM.test(str(rec?.startTime)) ? str(rec?.startTime) : null;
    const duration = int(rec?.duration);
    const members: PlannedMember[] = [];
    for (const m of raw.members ?? []) {
      const clientId = str(m?.clientId);
      const joinedOn = str(m?.membershipStart);
      if (!clientId || !ctx.clientIds.has(clientId) || !YMD.test(joinedOn)) {
        counts.membersSkippedUnknownClient++;
        continue;
      }
      const leftOn = YMD.test(str(m.membershipEnd)) ? str(m.membershipEnd) : null;
      members.push({ clientId, status: str(m.membershipStatus) === 'Inactive' ? 'inactive' : 'active', joinedOn, leftOn });
    }
    const sessions: PlannedSession[] = [];
    for (const o of raw.occurrences ?? []) {
      const date = str(o?.date);
      const time = str(o?.startTime);
      const mins = int(o?.duration);
      const oid = str(o?.id);
      if (!oid || !YMD.test(date) || !HM.test(time) || !mins) {
        counts.sessionsSkippedInvalid++;
        continue;
      }
      const st = str(o.status);
      sessions.push({ legacyId: oid, date, startTime: time, durationMinutes: mins, status: st === 'completed' ? 'completed' : st === 'cancelled' ? 'cancelled' : 'scheduled' });
    }
    // Attendance + note text: only unambiguous when there is exactly one occurrence
    const marks = (raw.members ?? []).filter((m) => legacyAttendance(m?.attendance) && ctx.clientIds.has(str(m?.clientId)));
    const individualized = raw.note?.individualized ?? {};
    const sharedText = str(raw.note?.commonText) || null;
    const hasText = Boolean(sharedText) || (raw.members ?? []).some((m) => str(individualized?.[str(m?.id)]) || str(m?.individualNote));
    let draft: PlannedGroup['draft'] = null;
    if (sessions.length === 1 && (marks.length || hasText)) {
      draft = {
        sessionLegacyId: sessions[0].legacyId,
        sharedText,
        attendance: marks.map((m) => ({
          clientId: str(m.clientId),
          status: legacyAttendance(m.attendance)!,
          legacyNoteText: str(individualized?.[str(m.id)]) || str(m.individualNote) || null,
        })),
      };
      counts.draftsAttached++;
      counts.attendanceMarksAttached += draft.attendance.length;
    } else {
      counts.attendanceMarksNotMigrated += marks.length;
      if (hasText) counts.noteTextsNotMigrated++;
    }
    counts.membersPlanned += members.length;
    counts.sessionsPlanned += sessions.length;
    counts.groupsPlanned++;
    groups.push({
      legacyId,
      name,
      kind: 'psychotherapy',
      groupType,
      description: str(raw.description) || null,
      facilitatorId,
      room: str(raw.location) || null,
      telehealth: str(raw.mode) === 'Telehealth',
      capacity: int(raw.capacity) ?? 10,
      defaultDurationMinutes: duration ?? sessions[0]?.durationMinutes ?? 60,
      billingCode: billing.billingCode,
      billingMode: billing.billingMode,
      status: raw.active === false ? 'archived' : 'active',
      recurFrequency: freq === 'weekly' || freq === 'biweekly' ? freq : null,
      recurWeekdays: weekdays,
      recurStartTime: startTime,
      recurStartDate: YMD.test(str(raw.startDate)) ? str(raw.startDate) : null,
      recurEndDate: YMD.test(str(raw.endDate)) ? str(raw.endDate) : null,
      members,
      sessions,
      draft,
    });
  }
  return { groups, counts };
}
