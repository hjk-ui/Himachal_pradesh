/**
 * Group module rules. Pure (no Prisma): billing eligibility per attendee, privacy checks on note
 * text, the 42 CFR Part 2 flag, co-signature, recurrence and the note body each attendee's chart
 * receives. Server code (./store.ts) and tests use the same functions.
 */
import { baseCode, PRP_CODES, type RuleFinding } from '@/lib/billing/claimRules';
import { cosignRequiredFor } from '@/lib/notes/transitions';
import { occurrenceInstants, validateRecurrence, type RecurrenceRule, type SeriesFrequency } from '@/lib/scheduling/recurrence';
import {
  ATTENDANCE_LABEL,
  GROUP_KIND_META,
  INDIVIDUAL_FIELDS,
  PART2_REDISCLOSURE_NOTICE,
  SHARED_FIELDS,
  isAttended,
  type AttendanceStatus,
  type BillingMode,
  type GroupKind,
  type NoteField,
  type NoteValues,
  type PlanGoalOption,
} from './types';

// ─── 42 CFR Part 2 ───────────────────────────────────────────────────────────

/** Every SUD group is Part 2. A psychotherapy group is not (a client's own Part 2 record still applies). */
export function isPart2Group(kind: GroupKind | string): boolean {
  return kind === 'sud';
}

/** Part 2 flag for one attendee's note: SUD group, or the client's own record is Part 2. */
export function notePart2(kind: GroupKind | string, clientIsPart2 = false): boolean {
  return isPart2Group(kind) || clientIsPart2;
}

/** A group's kind is permanent once any note exists (psychotherapy and SUD records are kept apart). */
export function kindChangeProblem(current: string, requested: string, hasNotes: boolean): string | null {
  if (current === requested) return null;
  if (hasNotes) return 'This group already has notes; its kind (group therapy vs SUD group counseling) cannot change. Create a new group instead.';
  return null;
}

// ─── Co-signature ────────────────────────────────────────────────────────────

/**
 * Same rule as every progress note (src/lib/notes/transitions.ts): pre-licensed by license level,
 * on a licensure supervision track, or a role that always needs a co-signature.
 */
export function groupNoteCosignRequired(role: string | null | undefined, onLicensureTrack: boolean, preLicensed: boolean): boolean {
  return cosignRequiredFor(role, onLicensureTrack, preLicensed);
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export type BillingGroup = {
  kind: GroupKind | string;
  billingCode: string | null;
  billingMode: BillingMode | string;
  minBillableMinutes: number | null;
  maxBillableGroupSize: number | null;
};

export type BillableLineInput = {
  group: BillingGroup;
  attendance: { status: AttendanceStatus | string; minutesAttended: number | null };
  /** Members who attended the session (present / late / left early) */
  groupSize: number | null;
  /** Scheduled length of the session */
  scheduledMinutes: number;
};

export type BillableLine = {
  billable: boolean;
  code: string | null;
  /** Minutes used for the decision (recorded, or the scheduled length when present with none recorded) */
  minutes: number | null;
  /** Why no line is made (empty when billable) */
  reasons: string[];
  warnings: string[];
};

/**
 * One attendee's claim line. Absent / excused / unmarked members are never billed. A line is made
 * only for a per-session group with a code, a member who attended with enough minutes (when billing
 * set a minimum), and a group size within the cap billing recorded. PRP codes never bill here.
 */
export function billableLine(input: BillableLineInput): BillableLine {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const { group, attendance } = input;
  const code = group.billingCode?.trim().toUpperCase() || null;
  const status = String(attendance.status);

  if (!isAttended(status)) {
    reasons.push(`Member was ${ATTENDANCE_LABEL[status as AttendanceStatus]?.toLowerCase() ?? 'not marked'}; absent, excused and unmarked members are never billed.`);
  }
  if (group.billingMode !== 'per_session') {
    reasons.push('Group is attendance only (no per-session claim line).');
  }
  if (!code) reasons.push('No billing code is set for this group.');
  if (code && PRP_CODES.has(baseCode(code))) reasons.push('PRP codes are billed from the PRP hub, not from group notes.');

  let minutes: number | null = attendance.minutesAttended ?? null;
  if (minutes == null && status === 'present') minutes = input.scheduledMinutes;
  if (isAttended(status) && minutes == null) {
    reasons.push('Record the minutes attended (member arrived late or left early).');
  }
  if (group.minBillableMinutes != null && minutes != null && minutes < group.minBillableMinutes) {
    reasons.push(`Attended ${minutes} min; this group needs at least ${group.minBillableMinutes} min to bill.`);
  }
  if (group.minBillableMinutes == null && (status === 'late' || status === 'left_early')) {
    warnings.push('No minimum billable minutes is set for this group; billing should confirm partial attendance.');
  }
  if (input.groupSize == null) {
    warnings.push('Group size was not recorded.');
  } else if (group.maxBillableGroupSize != null && input.groupSize > group.maxBillableGroupSize) {
    reasons.push(`Group size ${input.groupSize} is over the cap of ${group.maxBillableGroupSize} recorded for this group.`);
  }
  return { billable: reasons.length === 0, code: reasons.length === 0 ? code : null, minutes, reasons, warnings };
}

/** Claim-builder findings for a note written from a group session (errors block claim creation). */
export function groupClaimFindings(input: BillableLineInput): RuleFinding[] {
  const line = billableLine(input);
  return [
    ...line.reasons.map((message) => ({ code: 'GROUP_NOT_BILLABLE', severity: 'error' as const, message })),
    ...line.warnings.map((message) => ({ code: 'GROUP_BILLING_WARNING', severity: 'warning' as const, message })),
  ];
}

export function attendedCount(rows: { status: string }[]): number {
  return rows.filter((r) => isAttended(r.status)).length;
}

// ─── Privacy: other members never appear in a client's note ──────────────────

const NAME_STOP = new Set(['the', 'and', 'for', 'jr', 'sr', 'ii', 'iii', 'iv', 'mr', 'mrs', 'ms', 'dr']);

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Name parts worth matching on their own (3+ letters, not a title / suffix). */
export function nameTokens(name: string): string[] {
  return name
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^\p{L}'-]/gu, ''))
    .filter((t) => t.length >= 3 && !NAME_STOP.has(t.toLowerCase()));
}

export type NameMention = { name: string; matched: string; kind: 'full' | 'part' };

/**
 * Other attendees' names found in text. A full name matches in any case; a single first or last
 * name matches only as a capitalized whole word ("will" mid-sentence does not match a member named
 * Will). A capitalized common word can still match; the result is a warning the facilitator reviews.
 */
export function findNameMentions(text: string, others: { name: string }[]): NameMention[] {
  const out: NameMention[] = [];
  if (!text?.trim()) return out;
  for (const o of others) {
    const full = o.name?.trim();
    if (!full) continue;
    if (new RegExp(`(^|[^\\p{L}])${escapeRe(full)}($|[^\\p{L}])`, 'iu').test(text)) {
      out.push({ name: full, matched: full, kind: 'full' });
      continue;
    }
    for (const t of nameTokens(full)) {
      const cap = t[0].toUpperCase() + t.slice(1);
      if (new RegExp(`(^|[^\\p{L}])${escapeRe(cap)}($|[^\\p{L}])`, 'u').test(text)) {
        out.push({ name: full, matched: cap, kind: 'part' });
        break;
      }
    }
  }
  return out;
}

export function valuesText(values: NoteValues | null | undefined): string {
  if (!values) return '';
  return Object.values(values)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v) => v != null && v !== '')
    .map(String)
    .join('\n');
}

export type PrivacyWarning = { section: 'shared' | 'individual'; clientId?: string; names: string[] };

/**
 * Warnings (never blocks): the shared section names any attendee, or one attendee's individual
 * section names another attendee. Names are returned to the facilitator only.
 */
export function privacyWarnings(input: {
  shared: NoteValues | null | undefined;
  attendees: { clientId: string; name: string; individual: NoteValues | null | undefined }[];
}): PrivacyWarning[] {
  const out: PrivacyWarning[] = [];
  const sharedHits = findNameMentions(valuesText(input.shared), input.attendees);
  if (sharedHits.length) out.push({ section: 'shared', names: [...new Set(sharedHits.map((h) => h.name))] });
  for (const a of input.attendees) {
    const others = input.attendees.filter((o) => o.clientId !== a.clientId);
    const hits = findNameMentions(valuesText(a.individual), others);
    if (hits.length) out.push({ section: 'individual', clientId: a.clientId, names: [...new Set(hits.map((h) => h.name))] });
  }
  return out;
}

// ─── Note completeness and body ──────────────────────────────────────────────

export function missingRequired(fields: NoteField[], values: NoteValues | null | undefined): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = values?.[f.key];
      if (v == null) return true;
      if (Array.isArray(v)) return v.length === 0;
      return String(v).trim() === '';
    })
    .map((f) => f.label);
}

function fieldDisplay(f: NoteField, v: NoteValues[string], goals: PlanGoalOption[]): string | null {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  if (f.kind === 'goals') {
    const ids = Array.isArray(v) ? v : [String(v)];
    return ids.map((id) => goals.find((g) => g.id === id)?.text ?? id).map((t) => `- ${t}`).join('\n');
  }
  if (f.kind === 'select' || f.kind === 'multiselect') {
    const vals = Array.isArray(v) ? v : [String(v)];
    return vals.map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(', ');
  }
  return String(v).trim();
}

export type NoteBodyInput = {
  kind: GroupKind;
  groupName: string;
  groupTypeLabel: string;
  sessionDate: string;
  startTime: string;
  durationMinutes: number;
  telehealth: boolean;
  attendance: { status: AttendanceStatus | string; minutesAttended: number | null };
  /** Members who attended (a count only; never names) */
  groupSize: number | null;
  shared: NoteValues | null | undefined;
  individual: NoteValues | null | undefined;
  goals: PlanGoalOption[];
  facilitatorName: string | null;
  facilitatorCredentials: string | null;
  coFacilitatorName: string | null;
  billingCode: string | null;
};

/**
 * The note text placed in ONE client's chart: session facts, the shared group section and that
 * client's own section. It never lists the roster or other members.
 */
export function renderGroupNoteBody(input: NoteBodyInput): string {
  const meta = GROUP_KIND_META[input.kind];
  const lines: string[] = [];
  lines.push(`${meta.noteType.toUpperCase()}`);
  if (isPart2Group(input.kind)) lines.push(PART2_REDISCLOSURE_NOTICE);
  lines.push('');
  lines.push(`Group: ${input.groupName} (${input.groupTypeLabel})`);
  lines.push(`Date: ${input.sessionDate}  Start: ${input.startTime}  Scheduled length: ${input.durationMinutes} min`);
  lines.push(`Setting: ${input.telehealth ? 'Telehealth' : 'In person'}`);
  const att = ATTENDANCE_LABEL[input.attendance.status as AttendanceStatus] ?? String(input.attendance.status);
  lines.push(`Attendance: ${att}${input.attendance.minutesAttended != null ? `, ${input.attendance.minutesAttended} min attended` : ''}`);
  if (input.groupSize != null) lines.push(`Members attending: ${input.groupSize}`);
  if (input.billingCode) lines.push(`Service code: ${input.billingCode}`);
  lines.push('');
  lines.push('GROUP SESSION');
  for (const f of SHARED_FIELDS[input.kind]) {
    const v = fieldDisplay(f, input.shared?.[f.key], input.goals);
    if (v) lines.push(`${f.label}: ${v}`);
  }
  lines.push('');
  lines.push('CLIENT');
  for (const f of INDIVIDUAL_FIELDS[input.kind]) {
    const v = fieldDisplay(f, input.individual?.[f.key], input.goals);
    if (!v) continue;
    lines.push(f.kind === 'goals' ? `${f.label}:\n${v}` : `${f.label}: ${v}`);
  }
  lines.push('');
  const signer = [input.facilitatorName, input.facilitatorCredentials].filter(Boolean).join(', ');
  lines.push(`${meta.signerTitle}: ${signer || 'not recorded'}`);
  if (input.coFacilitatorName) lines.push(`Co-facilitator: ${input.coFacilitatorName}`);
  return lines.join('\n');
}

// ─── Recurrence ──────────────────────────────────────────────────────────────

export type GroupRecurrence = {
  recurFrequency: string | null;
  recurInterval: number | null;
  recurWeekdays: number[];
  recurStartTime: string | null;
  recurStartDate: string | null;
  recurEndDate: string | null;
  defaultDurationMinutes: number;
};

/** The series rule for a group's schedule, starting at `fromDate` (bounded by the series caps). */
export function groupRecurrenceRule(g: GroupRecurrence, fromDate: string, count: number): RecurrenceRule | null {
  if (!g.recurFrequency || !g.recurStartTime || !g.recurStartDate) return null;
  const startDate = fromDate > g.recurStartDate ? fromDate : g.recurStartDate;
  return {
    frequency: g.recurFrequency as SeriesFrequency,
    interval: g.recurInterval ?? 1,
    byWeekday: g.recurWeekdays.length ? g.recurWeekdays : null,
    startDate,
    endDate: g.recurEndDate && g.recurEndDate >= startDate ? g.recurEndDate : null,
    count: g.recurEndDate ? null : count,
    startTime: g.recurStartTime,
    durationMinutes: g.defaultDurationMinutes,
  };
}

/**
 * Occurrences to create: the group's rule from `fromDate`, minus starts that already exist
 * (idempotent), never in the past. Uses the appointment-series helpers (DST-safe wall clock).
 */
export function plannedOccurrences(
  g: GroupRecurrence,
  opts: { fromDate: string; count: number; timeZone: string; now: Date; existingStarts: Date[] }
): { ok: true; occurrences: { date: string; start: Date; end: Date }[] } | { ok: false; error: string } {
  const rule = groupRecurrenceRule(g, opts.fromDate, opts.count);
  if (!rule) return { ok: false, error: 'Set the group’s repeat schedule (frequency, start date and time) first.' };
  // Clamp an end date that runs past the series cap to the count instead
  let invalid = validateRecurrence(rule);
  if (invalid && rule.endDate) {
    rule.endDate = null;
    rule.count = opts.count;
    invalid = validateRecurrence(rule);
  }
  if (invalid) return { ok: false, error: invalid };
  const existing = new Set(opts.existingStarts.map((d) => d.getTime()));
  const occurrences = occurrenceInstants(rule, opts.timeZone).filter(
    (o) => o.end.getTime() > opts.now.getTime() && !existing.has(o.start.getTime())
  );
  return { ok: true, occurrences };
}

// ─── Appointment status from attendance ──────────────────────────────────────

/** Per-member appointment status that mirrors the attendance mark. */
export function appointmentStatusForAttendance(status: string): 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'SCHEDULED' {
  if (isAttended(status)) return 'COMPLETED';
  if (status === 'absent') return 'NO_SHOW';
  if (status === 'excused') return 'CANCELLED';
  return 'SCHEDULED';
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export type ReportSession = { id: string; groupId: string; status: string; groupSize: number | null };
export type ReportAttendance = { sessionId: string; groupId: string; clientId: string; status: string; noteSigned: boolean; hasNote: boolean; claimId: string | null };

export type GroupReportRow = {
  groupId: string;
  sessionsHeld: number;
  sessionsCancelled: number;
  marked: number;
  attended: number;
  absent: number;
  excused: number;
  attendanceRate: number | null;
  averageGroupSize: number | null;
  notesUnsigned: number;
  claimsGenerated: number;
  members: number;
};

/**
 * Attendance and utilization per group. Held = completed sessions plus past sessions that have
 * attendance marked. Attendance rate = attended / marked (present + late + left early + absent +
 * excused). Average group size = recorded group size (members who attended) per held session.
 */
export function aggregateGroupReport(sessions: ReportSession[], attendance: ReportAttendance[]): GroupReportRow[] {
  const bySession = new Map<string, ReportAttendance[]>();
  for (const a of attendance) {
    const list = bySession.get(a.sessionId) ?? [];
    list.push(a);
    bySession.set(a.sessionId, list);
  }
  const groups = new Map<string, GroupReportRow & { clients: Set<string>; heldAttended: number }>();
  const row = (groupId: string) => {
    let r = groups.get(groupId);
    if (!r) {
      r = { groupId, sessionsHeld: 0, sessionsCancelled: 0, marked: 0, attended: 0, absent: 0, excused: 0, attendanceRate: null, averageGroupSize: null, notesUnsigned: 0, claimsGenerated: 0, members: 0, clients: new Set(), heldAttended: 0 };
      groups.set(groupId, r);
    }
    return r;
  };
  for (const s of sessions) {
    const r = row(s.groupId);
    const rows = bySession.get(s.id) ?? [];
    if (s.status === 'cancelled') {
      r.sessionsCancelled++;
      continue;
    }
    const marked = rows.filter((a) => a.status !== 'unmarked');
    const held = s.status === 'completed' || marked.length > 0;
    if (!held) continue;
    r.sessionsHeld++;
    const att = marked.filter((a) => isAttended(a.status)).length;
    // Recorded group size (all members) when present; the scoped rows otherwise
    r.heldAttended += s.groupSize ?? att;
    for (const a of marked) {
      r.marked++;
      r.clients.add(a.clientId);
      if (isAttended(a.status)) r.attended++;
      else if (a.status === 'absent') r.absent++;
      else if (a.status === 'excused') r.excused++;
      if (a.hasNote && !a.noteSigned && isAttended(a.status)) r.notesUnsigned++;
      if (a.claimId) r.claimsGenerated++;
    }
  }
  return [...groups.values()].map(({ clients, heldAttended, ...r }) => ({
    ...r,
    members: clients.size,
    attendanceRate: r.marked ? Math.round((r.attended / r.marked) * 1000) / 10 : null,
    averageGroupSize: r.sessionsHeld ? Math.round((heldAttended / r.sessionsHeld) * 10) / 10 : null,
  }));
}

/** Attendance per member within one group (attendance report tab). */
export function memberAttendanceRows(attendance: Pick<ReportAttendance, 'clientId' | 'status'>[]) {
  const map = new Map<string, { clientId: string; attended: number; absent: number; excused: number; marked: number }>();
  for (const a of attendance) {
    if (a.status === 'unmarked') continue;
    const r = map.get(a.clientId) ?? { clientId: a.clientId, attended: 0, absent: 0, excused: 0, marked: 0 };
    r.marked++;
    if (isAttended(a.status)) r.attended++;
    else if (a.status === 'absent') r.absent++;
    else if (a.status === 'excused') r.excused++;
    map.set(a.clientId, r);
  }
  return [...map.values()].map((r) => ({ ...r, attendanceRate: r.marked ? Math.round((r.attended / r.marked) * 1000) / 10 : null }));
}
