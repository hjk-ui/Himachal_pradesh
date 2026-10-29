/**
 * PRP hub aggregation and reports. Pure functions over rows already loaded and scoped by
 * src/lib/prp/program.ts, so they can be unit tested. Nothing here invents a value: a
 * number is a count of stored rows, and anything not stored is reported as not recorded.
 */
import { MORS_LEVELS, PRP_BILLING_RULE_NOTE, PRP_UNIT_RULE_LABEL } from './billingRule';
import { encounterDocIssues, monthlyMinimumState, morsDue, PRP_DISCHARGE_TYPES, type PrpBillingState } from './standard';

export const PRP_SERVICE_TYPES = ['group', 'individual', 'community'] as const;
export type PrpServiceType = (typeof PRP_SERVICE_TYPES)[number];

export const PRP_ENROLLMENT_STATUSES = ['active', 'on_hold', 'transitioning', 'discharged'] as const;
export type PrpEnrollmentStatus = (typeof PRP_ENROLLMENT_STATUSES)[number];

export const PRP_REPORT_TYPES = ['monthly-progress', 'group-attendance', 'billing-summary', 'transition', 'mors'] as const;
export type PrpReportType = (typeof PRP_REPORT_TYPES)[number];

export type EnrollmentRow = {
  id: string;
  clientId: string;
  clientName: string;
  displayId: string | null;
  status: string;
  startDate: Date | null;
  createdAt: Date;
  statusChangedAt: Date | null;
  dischargedAt: Date | null;
  dischargeReason: string | null;
  specialistId: string | null;
  specialistName: string | null;
  diagnosisCode: string;
  dischargeType?: string | null;
  transitionPlan?: string | null;
  aftercarePlan?: string | null;
};

export type AttendanceRow = {
  id: string;
  enrollmentId: string;
  clientId: string;
  groupId: string | null;
  serviceDate: Date;
  minutes: number | null;
  serviceType: string;
  billable: boolean;
  /** Documentation fields (optional for rows loaded before 20261022_prp_standard.sql) */
  location?: string | null;
  irpGoal?: string | null;
  intervention?: string | null;
  response?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
};

export type GroupRow = { id: string; name: string; active: boolean };

export type IrpGoal = { need: string; targetDate: string | null };
export type IrpSummary = {
  clientId: string;
  status: 'draft' | 'final' | null;
  effectiveDate: Date | null;
  reviewDueDate: Date | null;
  goals: IrpGoal[];
  recommendedDomains: string[];
};

export type MorsRow = { enrollmentId: string; month: string; rating: number };

// ─── Attendance write plan ──

export type AttendanceEntry = {
  enrollmentId: string;
  present: boolean;
  billable?: boolean;
  minutes?: number | null;
  note?: string | null;
  location?: 'onsite' | 'offsite' | null;
  irpGoal?: string | null;
  intervention?: string | null;
  response?: string | null;
};
export type RecordAttendanceInput = {
  serviceDate: string;
  serviceType: PrpServiceType;
  groupId?: string | null;
  minutes?: number | null;
  location?: 'onsite' | 'offsite' | null;
  intervention?: string | null;
  entries: AttendanceEntry[];
};

/**
 * Plan the writes for a roster submission. Idempotent for group sessions: one row per
 * (enrollment, group, date); re-submitting updates it, unticking removes it.
 * Individual/community services always add a row for each present entry.
 */
export function planAttendanceWrites(
  input: RecordAttendanceInput,
  existing: { id: string; enrollmentId: string }[],
) {
  const byEnrollment = new Map(existing.map((e) => [e.enrollmentId, e.id]));
  const creates: AttendanceEntry[] = [];
  const updates: (AttendanceEntry & { id: string })[] = [];
  const deletes: string[] = [];
  for (const entry of input.entries) {
    const id = input.serviceType === 'group' ? byEnrollment.get(entry.enrollmentId) : undefined;
    if (entry.present) {
      if (id) updates.push({ ...entry, id });
      else creates.push(entry);
    } else if (id) {
      deletes.push(id);
    }
  }
  return { creates, updates, deletes };
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD -> Date at 00:00 UTC, or null when not a real calendar date. */
export function parseServiceDate(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

export function isMonth(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** [start, end) of a YYYY-MM month in UTC. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function inMonth(d: Date | null | undefined, month: string): boolean {
  return !!d && monthOf(d) === month;
}

// ─── IRP parsing ────────────────────────────────────────────────────────────

/** Reads the goals the IRP builder stores in PrpWorkflow.irpData (only rows with a need or a goal). */
export function irpFromWorkflow(w: {
  clientId: string;
  irpData: unknown;
  irpEffectiveDate: Date | null;
  irpReviewDueDate: Date | null;
  recommendedDomains: string[];
}): IrpSummary {
  const data = w.irpData && typeof w.irpData === 'object' ? (w.irpData as Record<string, unknown>) : {};
  const status = data.status === 'final' || data.status === 'draft' ? data.status : null;
  const rawGoals = Array.isArray(data.goals) ? data.goals : [];
  const goals: IrpGoal[] = rawGoals
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .filter((g) => [g.need, g.longTermGoal, g.shortTermGoal].some((x) => typeof x === 'string' && x.trim() !== ''))
    .map((g) => ({
      need: typeof g.need === 'string' && g.need.trim() ? g.need.trim() : 'Need area not selected',
      targetDate: typeof g.targetDate === 'string' && g.targetDate ? g.targetDate : null,
    }));
  let reviewDue = w.irpReviewDueDate;
  if (!reviewDue && typeof data.nextIRPReviewDate === 'string') {
    const d = parseServiceDate(data.nextIRPReviewDate);
    if (d) reviewDue = d;
  }
  return {
    clientId: w.clientId,
    status: Object.keys(data).length ? status : null,
    effectiveDate: w.irpEffectiveDate,
    reviewDueDate: reviewDue,
    goals: status ? goals : [],
    recommendedDomains: w.recommendedDomains ?? [],
  };
}

// ─── Hub ────────────────────────────────────────────────────────────────────

export function lastServiceByEnrollment(attendance: AttendanceRow[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const a of attendance) {
    const prev = out.get(a.enrollmentId);
    if (!prev || a.serviceDate > prev) out.set(a.enrollmentId, a.serviceDate);
  }
  return out;
}

export function irpReviewState(reviewDue: Date | null, now: Date): 'none' | 'overdue' | 'due_30' | 'ok' {
  if (!reviewDue) return 'none';
  const days = (reviewDue.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return 'overdue';
  if (days <= 30) return 'due_30';
  return 'ok';
}

/** Goal counts by IRP need area (finalized and draft IRPs). No completion rate: goal status is not stored. */
export function goalsByNeed(irps: IrpSummary[]) {
  const map = new Map<string, { need: string; goals: number; participants: Set<string>; finalGoals: number }>();
  for (const irp of irps) {
    for (const g of irp.goals) {
      const row = map.get(g.need) ?? { need: g.need, goals: 0, participants: new Set<string>(), finalGoals: 0 };
      row.goals += 1;
      if (irp.status === 'final') row.finalGoals += 1;
      row.participants.add(irp.clientId);
      map.set(g.need, row);
    }
  }
  return [...map.values()]
    .map((r) => ({ need: r.need, goals: r.goals, finalGoals: r.finalGoals, participants: r.participants.size }))
    .sort((a, b) => b.goals - a.goals || a.need.localeCompare(b.need));
}

export function domainsFromReferrals(irps: IrpSummary[]) {
  const map = new Map<string, number>();
  for (const irp of irps) for (const d of new Set(irp.recommendedDomains)) map.set(d, (map.get(d) ?? 0) + 1);
  return [...map.entries()].map(([domain, participants]) => ({ domain, participants })).sort((a, b) => b.participants - a.participants);
}

export function hubStats(input: {
  enrollments: EnrollmentRow[];
  attendance: AttendanceRow[];
  referralsAwaiting: number;
  irps: Map<string, IrpSummary>;
  month: string;
  now: Date;
  mors?: MorsRow[];
}) {
  const active = input.enrollments.filter((e) => e.status === 'active' || e.status === 'transitioning');
  const monthRows = input.attendance.filter((a) => inMonth(a.serviceDate, input.month));
  const reviewDue = active.filter((e) => {
    const s = irpReviewState(input.irps.get(e.clientId)?.reviewDueDate ?? null, input.now);
    return s === 'overdue' || s === 'due_30';
  }).length;
  const noIrp = active.filter((e) => input.irps.get(e.clientId)?.status !== 'final').length;
  const open = input.enrollments.filter((e) => e.status !== 'discharged');
  const rated = new Set((input.mors ?? []).filter((m) => m.month === input.month).map((m) => m.enrollmentId));
  return {
    activeParticipants: active.length,
    encountersThisMonth: monthRows.length,
    participantsServedThisMonth: new Set(monthRows.map((a) => a.enrollmentId)).size,
    referralsAwaiting: input.referralsAwaiting,
    irpReviewsDue30: reviewDue,
    activeWithoutFinalIrp: noIrp,
    /** Open enrollments without a MORS rating for the month (MORS is monthly); null when ratings were not loaded */
    morsDueThisMonth: input.mors ? open.filter((e) => morsDue(e.status, rated.has(e.id) ? 1 : null)).length : null,
    /** Encounters this month missing a documentation element (encounterDocIssues) */
    incompleteEncountersThisMonth: monthRows.filter((a) => encounterDocIssues(a).length > 0).length,
  };
}

// ─── Reports ────────────────────────────────────────────────────────────────

type Counts = { encounters: number; billable: number; minutes: number; minutesRecorded: number; group: number; individual: number; community: number };

function countRows(rows: AttendanceRow[]): Counts {
  const c: Counts = { encounters: 0, billable: 0, minutes: 0, minutesRecorded: 0, group: 0, individual: 0, community: 0 };
  for (const a of rows) {
    c.encounters += 1;
    if (a.billable) c.billable += 1;
    if (a.minutes != null) {
      c.minutes += a.minutes;
      c.minutesRecorded += 1;
    }
    if (a.serviceType === 'group' || a.serviceType === 'individual' || a.serviceType === 'community') c[a.serviceType] += 1;
  }
  return c;
}

function byEnrollment(attendance: AttendanceRow[], month: string) {
  const map = new Map<string, AttendanceRow[]>();
  for (const a of attendance) {
    if (!inMonth(a.serviceDate, month)) continue;
    const list = map.get(a.enrollmentId) ?? [];
    list.push(a);
    map.set(a.enrollmentId, list);
  }
  return map;
}

/** Enrollments that were open at some point in the month. */
export function enrolledDuring(e: EnrollmentRow, month: string): boolean {
  const { start, end } = monthBounds(month);
  const began = e.startDate ?? e.createdAt;
  if (began >= end) return false;
  if (e.dischargedAt && e.dischargedAt < start) return false;
  return true;
}

export function monthlyProgressReport(input: {
  month: string;
  enrollments: EnrollmentRow[];
  attendance: AttendanceRow[];
  irps: Map<string, IrpSummary>;
  mors: MorsRow[];
  /** Practice monthly contact minimum (null = not set: no flag) */
  monthlyMinContacts?: number | null;
}) {
  const att = byEnrollment(input.attendance, input.month);
  const last = lastServiceByEnrollment(input.attendance.filter((a) => a.serviceDate < monthBounds(input.month).end));
  const morsBy = new Map(input.mors.filter((m) => m.month === input.month).map((m) => [m.enrollmentId, m.rating]));
  const monthEnd = monthBounds(input.month).end;
  return input.enrollments
    .filter((e) => enrolledDuring(e, input.month))
    .map((e) => {
      const list = att.get(e.id) ?? [];
      const c = countRows(list);
      const irp = input.irps.get(e.clientId);
      const minimum = monthlyMinimumState(c.billable, input.monthlyMinContacts ?? null);
      const goals = irp?.goals ?? [];
      const pastTarget = goals.filter((g) => g.targetDate && g.targetDate < isoDay(monthEnd)!).length;
      return {
        enrollmentId: e.id,
        participant: e.clientName,
        displayId: e.displayId,
        specialist: e.specialistName,
        status: e.status,
        encounters: c.encounters,
        billableEncounters: c.billable,
        groupEncounters: c.group,
        individualEncounters: c.individual,
        communityEncounters: c.community,
        minutes: c.minutesRecorded ? c.minutes : null,
        lastServiceDate: isoDay(last.get(e.id)),
        irpStatus: irp?.status ?? null,
        irpReviewDue: isoDay(irp?.reviewDueDate ?? null),
        irpGoals: goals.length,
        goalsPastTargetDate: pastTarget,
        morsRating: morsBy.get(e.id) ?? null,
        incompleteEncounters: list.filter((a) => encounterDocIssues(a).length > 0).length,
        monthlyMinimum: minimum.label,
      };
    })
    .sort((a, b) => a.participant.localeCompare(b.participant));
}

export function groupAttendanceReport(input: { month: string; groups: GroupRow[]; attendance: AttendanceRow[] }) {
  const rows = input.attendance.filter((a) => inMonth(a.serviceDate, input.month) && a.serviceType === 'group');
  const names = new Map(input.groups.map((g) => [g.id, g.name]));
  const map = new Map<string, AttendanceRow[]>();
  for (const a of rows) {
    const key = a.groupId ?? '';
    map.set(key, [...(map.get(key) ?? []), a]);
  }
  return [...map.entries()]
    .map(([groupId, list]) => {
      const dates = [...new Set(list.map((a) => isoDay(a.serviceDate)!))].sort();
      return {
        groupId: groupId || null,
        group: groupId ? names.get(groupId) ?? 'Group no longer listed' : 'Group not recorded',
        sessionsHeld: dates.length,
        attendances: list.length,
        uniqueParticipants: new Set(list.map((a) => a.enrollmentId)).size,
        avgPerSession: dates.length ? Math.round((list.length / dates.length) * 10) / 10 : 0,
        dates,
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group));
}

export function billingSummaryReport(input: {
  month: string;
  enrollments: EnrollmentRow[];
  attendance: AttendanceRow[];
  /** Practice-confirmed billing model (src/lib/prp/standard.ts); omitted = not reported */
  billing?: PrpBillingState;
  monthlyMinContacts?: number | null;
}) {
  const att = byEnrollment(input.attendance, input.month);
  const rows = input.enrollments
    .filter((e) => att.has(e.id))
    .map((e) => {
      const list = att.get(e.id)!;
      const c = countRows(list);
      return {
        enrollmentId: e.id,
        participant: e.clientName,
        displayId: e.displayId,
        diagnosisCode: e.diagnosisCode,
        incompleteEncounters: list.filter((a) => encounterDocIssues(a).length > 0).length,
        monthlyMinimum: monthlyMinimumState(c.billable, input.monthlyMinContacts ?? null).label,
        encounters: c.encounters,
        billableEncounters: c.billable,
        nonBillableEncounters: c.encounters - c.billable,
        serviceDays: new Set(list.map((a) => isoDay(a.serviceDate))).size,
        firstServiceDate: isoDay(list.reduce((m, a) => (a.serviceDate < m ? a.serviceDate : m), list[0].serviceDate)),
        lastServiceDate: isoDay(list.reduce((m, a) => (a.serviceDate > m ? a.serviceDate : m), list[0].serviceDate)),
        units: null as number | null,
      };
    })
    .sort((a, b) => a.participant.localeCompare(b.participant));
  return {
    rows,
    unitRuleConfirmed: Boolean(input.billing?.confirmed),
    unitRuleLabel: PRP_UNIT_RULE_LABEL,
    ruleNote: PRP_BILLING_RULE_NOTE,
    billingModel: input.billing?.model ?? null,
    billingModelLabel: input.billing?.label ?? null,
    totals: {
      participants: rows.length,
      encounters: rows.reduce((s, r) => s + r.encounters, 0),
      billableEncounters: rows.reduce((s, r) => s + r.billableEncounters, 0),
    },
  };
}

export function transitionReport(input: { month: string; enrollments: EnrollmentRow[] }) {
  return input.enrollments
    .filter(
      (e) =>
        (e.status === 'transitioning' || e.status === 'discharged' || e.status === 'on_hold') &&
        (inMonth(e.statusChangedAt, input.month) || inMonth(e.dischargedAt, input.month) || e.status === 'transitioning'),
    )
    .map((e) => ({
      enrollmentId: e.id,
      participant: e.clientName,
      displayId: e.displayId,
      specialist: e.specialistName,
      status: e.status,
      statusChangedAt: isoDay(e.statusChangedAt),
      dischargedAt: isoDay(e.dischargedAt),
      dischargeReason: e.dischargeReason,
      dischargeType: PRP_DISCHARGE_TYPES.find((t) => t.value === e.dischargeType)?.label ?? null,
      transitionPlan: e.transitionPlan ?? null,
      aftercarePlan: e.aftercarePlan ?? null,
      enrolledSince: isoDay(e.startDate ?? e.createdAt),
    }))
    .sort((a, b) => a.participant.localeCompare(b.participant));
}

export function morsReport(input: { month: string; enrollments: EnrollmentRow[]; mors: MorsRow[] }) {
  const by = new Map(input.mors.filter((m) => m.month === input.month).map((m) => [m.enrollmentId, m.rating]));
  const label = (r: number) => MORS_LEVELS.find((l) => l.rating === r)?.label ?? '';
  const rows = input.enrollments
    .filter((e) => enrolledDuring(e, input.month))
    .map((e) => {
      const r = by.get(e.id) ?? null;
      return { enrollmentId: e.id, participant: e.clientName, displayId: e.displayId, rating: r, level: r ? label(r) : 'Not recorded yet' };
    })
    .sort((a, b) => a.participant.localeCompare(b.participant));
  return { rows, recorded: rows.filter((r) => r.rating != null).length };
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function cell(v: unknown): string {
  if (v == null) return '';
  let s = Array.isArray(v) ? v.join(' ') : String(v);
  // Spreadsheet formula injection guard
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[], preamble: string[] = []): string {
  const lines = [
    ...preamble.map((p) => cell(p)),
    columns.map((c) => cell(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(',')),
  ];
  return lines.join('\r\n') + '\r\n';
}

export const REPORT_COLUMNS: Record<PrpReportType, { key: string; label: string }[]> = {
  'monthly-progress': [
    { key: 'participant', label: 'Participant' },
    { key: 'displayId', label: 'PRP ID' },
    { key: 'specialist', label: 'PRP specialist' },
    { key: 'status', label: 'Status' },
    { key: 'encounters', label: 'Encounters' },
    { key: 'billableEncounters', label: 'Billable encounters' },
    { key: 'groupEncounters', label: 'Group' },
    { key: 'individualEncounters', label: 'Individual' },
    { key: 'communityEncounters', label: 'Community' },
    { key: 'minutes', label: 'Minutes recorded' },
    { key: 'lastServiceDate', label: 'Last service date' },
    { key: 'irpStatus', label: 'IRP status' },
    { key: 'irpReviewDue', label: 'IRP review due' },
    { key: 'irpGoals', label: 'IRP goals' },
    { key: 'goalsPastTargetDate', label: 'Goals past target date' },
    { key: 'morsRating', label: 'MORS' },
    { key: 'incompleteEncounters', label: 'Encounters missing documentation' },
    { key: 'monthlyMinimum', label: 'Monthly minimum (practice policy)' },
  ],
  'group-attendance': [
    { key: 'group', label: 'Group' },
    { key: 'sessionsHeld', label: 'Sessions held' },
    { key: 'attendances', label: 'Attendances' },
    { key: 'uniqueParticipants', label: 'Unique participants' },
    { key: 'avgPerSession', label: 'Average per session' },
    { key: 'dates', label: 'Dates' },
  ],
  'billing-summary': [
    { key: 'participant', label: 'Participant' },
    { key: 'displayId', label: 'PRP ID' },
    { key: 'diagnosisCode', label: 'Diagnosis' },
    { key: 'encounters', label: 'Encounters' },
    { key: 'billableEncounters', label: 'Billable encounters' },
    { key: 'nonBillableEncounters', label: 'Non-billable encounters' },
    { key: 'serviceDays', label: 'Service days' },
    { key: 'firstServiceDate', label: 'First service' },
    { key: 'lastServiceDate', label: 'Last service' },
    { key: 'incompleteEncounters', label: 'Encounters missing documentation' },
    { key: 'monthlyMinimum', label: 'Monthly minimum (practice policy)' },
    { key: 'units', label: 'Units (not calculated)' },
  ],
  transition: [
    { key: 'participant', label: 'Participant' },
    { key: 'displayId', label: 'PRP ID' },
    { key: 'specialist', label: 'PRP specialist' },
    { key: 'status', label: 'Status' },
    { key: 'statusChangedAt', label: 'Status changed' },
    { key: 'dischargedAt', label: 'Discharged' },
    { key: 'dischargeType', label: 'Discharge type' },
    { key: 'dischargeReason', label: 'Discharge reason' },
    { key: 'transitionPlan', label: 'Transition plan' },
    { key: 'aftercarePlan', label: 'Aftercare plan' },
    { key: 'enrolledSince', label: 'Enrolled since' },
  ],
  mors: [
    { key: 'participant', label: 'Participant' },
    { key: 'displayId', label: 'PRP ID' },
    { key: 'rating', label: 'MORS rating' },
    { key: 'level', label: 'MORS level' },
  ],
};
