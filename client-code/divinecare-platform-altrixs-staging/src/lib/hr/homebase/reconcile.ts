/**
 * Pay-period summary and payroll reconciliation (pure, no I/O).
 *
 * HIPAA: HR must never see client PHI. Inputs and outputs here are COUNTS and MINUTES per
 * clinician per practice day. There is no field for a client name, id, MRN, diagnosis or note
 * text, and the CSV has only the columns in RECONCILIATION_CSV_COLUMNS.
 */
import { isClinicalRole } from '@/lib/hr/standard';

export type TimecardDay = { homebaseEmployeeId: string; day: string; workedMinutes: number | null; open?: boolean };
export type VisitDay = { userId: string; day: string; completedVisits: number; scheduledVisits: number; scheduledMinutes: number };
export type NoteCounts = { userId: string; signedNotes: number; unsignedNotes: number; unsignedPastDue: number };
export type ReconStaff = { userId: string; name: string; role: string };

export type ReconciliationFlag = 'unsigned_notes_before_payroll' | 'visits_without_clock_in' | 'clocked_days_without_visits' | 'not_linked_to_homebase' | 'open_timecards';

export type ReconciliationRow = {
  userId: string;
  name: string;
  role: string;
  homebaseLinked: boolean;
  clockedMinutes: number;
  clockedHours: number;
  clockedDays: number;
  openTimecards: number;
  completedVisits: number;
  scheduledVisits: number;
  scheduledVisitMinutes: number;
  signedNotes: number;
  unsignedNotes: number;
  unsignedPastDue: number;
  /** Practice days with completed visits but no Homebase clock-in */
  visitDaysWithoutClockIn: string[];
  /** Completed visits on those days */
  visitsWithoutClockIn: number;
  /** Practice days clocked in Homebase with no completed visit (clinical roles only) */
  clockedDaysWithoutVisits: string[];
  flags: ReconciliationFlag[];
};

export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export function buildReconciliation(input: {
  staff: ReconStaff[];
  /** Altrixs user id → linked Homebase employee ids */
  links: Map<string, string[]>;
  timecards: TimecardDay[];
  visits: VisitDay[];
  notes: NoteCounts[];
}): { rows: ReconciliationRow[]; totals: { clinicians: number; clockedHours: number; completedVisits: number; unsignedPastDue: number; flagged: number } } {
  const tcByEmployee = new Map<string, TimecardDay[]>();
  for (const t of input.timecards) tcByEmployee.set(t.homebaseEmployeeId, [...(tcByEmployee.get(t.homebaseEmployeeId) ?? []), t]);
  const visitsByUser = new Map<string, VisitDay[]>();
  for (const v of input.visits) visitsByUser.set(v.userId, [...(visitsByUser.get(v.userId) ?? []), v]);
  const notesByUser = new Map(input.notes.map((n) => [n.userId, n]));

  const included = input.staff.filter(
    (s) => isClinicalRole(s.role) || visitsByUser.has(s.userId) || notesByUser.has(s.userId),
  );
  const rows: ReconciliationRow[] = included.map((s) => {
    const hbIds = input.links.get(s.userId) ?? [];
    const cards = hbIds.flatMap((id) => tcByEmployee.get(id) ?? []);
    const clockedMinutes = cards.reduce((sum, c) => sum + (c.workedMinutes ?? 0), 0);
    const clockedDaySet = new Set(cards.map((c) => c.day));
    const openTimecards = cards.filter((c) => c.open || c.workedMinutes === null).length;
    const vdays = visitsByUser.get(s.userId) ?? [];
    const completedVisits = vdays.reduce((n, v) => n + v.completedVisits, 0);
    const scheduledVisits = vdays.reduce((n, v) => n + v.scheduledVisits, 0);
    const scheduledVisitMinutes = vdays.reduce((n, v) => n + v.scheduledMinutes, 0);
    const visitDaySet = new Set(vdays.filter((v) => v.completedVisits > 0).map((v) => v.day));
    const linked = hbIds.length > 0;
    const visitDaysWithoutClockIn = linked ? [...visitDaySet].filter((d) => !clockedDaySet.has(d)).sort() : [];
    const visitsWithoutClockIn = vdays.filter((v) => visitDaysWithoutClockIn.includes(v.day)).reduce((n, v) => n + v.completedVisits, 0);
    const clockedDaysWithoutVisits = isClinicalRole(s.role) ? [...clockedDaySet].filter((d) => !visitDaySet.has(d)).sort() : [];
    const n = notesByUser.get(s.userId) ?? { signedNotes: 0, unsignedNotes: 0, unsignedPastDue: 0 };
    const flags: ReconciliationFlag[] = [];
    if (!linked) flags.push('not_linked_to_homebase');
    if (n.unsignedPastDue > 0) flags.push('unsigned_notes_before_payroll');
    if (visitDaysWithoutClockIn.length) flags.push('visits_without_clock_in');
    if (clockedDaysWithoutVisits.length) flags.push('clocked_days_without_visits');
    if (openTimecards) flags.push('open_timecards');
    return {
      userId: s.userId,
      name: s.name,
      role: s.role,
      homebaseLinked: linked,
      clockedMinutes,
      clockedHours: hoursOf(clockedMinutes),
      clockedDays: clockedDaySet.size,
      openTimecards,
      completedVisits,
      scheduledVisits,
      scheduledVisitMinutes,
      signedNotes: n.signedNotes,
      unsignedNotes: n.unsignedNotes,
      unsignedPastDue: n.unsignedPastDue,
      visitDaysWithoutClockIn,
      visitsWithoutClockIn,
      clockedDaysWithoutVisits,
      flags,
    };
  });
  rows.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name));
  return {
    rows,
    totals: {
      clinicians: rows.length,
      clockedHours: hoursOf(rows.reduce((s, r) => s + r.clockedMinutes, 0)),
      completedVisits: rows.reduce((s, r) => s + r.completedVisits, 0),
      unsignedPastDue: rows.reduce((s, r) => s + r.unsignedPastDue, 0),
      flagged: rows.filter((r) => r.flags.some((f) => f !== 'not_linked_to_homebase')).length,
    },
  };
}

// ─── Pay-period hours summary ────────────────────────────────────────────────

export type PayPeriodEmployee = { homebaseId: string; name: string; userId: string | null; altrixsName: string | null };
export type PayPeriodRow = PayPeriodEmployee & { workedMinutes: number; hours: number; days: number; timecards: number; openTimecards: number; breakMinutes: number };

export function summarizePayPeriod(
  employees: PayPeriodEmployee[],
  timecards: Array<TimecardDay & { breakMinutes?: number }>,
): { rows: PayPeriodRow[]; totalHours: number } {
  const byEmp = new Map<string, Array<TimecardDay & { breakMinutes?: number }>>();
  for (const t of timecards) byEmp.set(t.homebaseEmployeeId, [...(byEmp.get(t.homebaseEmployeeId) ?? []), t]);
  const rows = employees
    .map((e) => {
      const cards = byEmp.get(e.homebaseId) ?? [];
      const workedMinutes = cards.reduce((s, c) => s + (c.workedMinutes ?? 0), 0);
      return {
        ...e,
        workedMinutes,
        hours: hoursOf(workedMinutes),
        days: new Set(cards.map((c) => c.day)).size,
        timecards: cards.length,
        openTimecards: cards.filter((c) => c.open || c.workedMinutes === null).length,
        breakMinutes: cards.reduce((s, c) => s + (c.breakMinutes ?? 0), 0),
      };
    })
    .filter((r) => r.timecards > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, totalHours: hoursOf(rows.reduce((s, r) => s + r.workedMinutes, 0)) };
}

// ─── CSV (counts only) ───────────────────────────────────────────────────────

export const RECONCILIATION_CSV_COLUMNS = [
  'Clinician',
  'Role',
  'Linked to Homebase',
  'Clocked hours',
  'Clocked days',
  'Open timecards',
  'Completed visits',
  'Scheduled visits',
  'Scheduled visit minutes',
  'Signed notes',
  'Unsigned notes',
  'Unsigned notes past due',
  'Visit days without clock-in',
  'Clocked days without visits',
  'Flags',
] as const;

/** CSV cell: quoted, with spreadsheet formula injection neutralized. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function reconciliationCsv(rows: ReconciliationRow[], period: { start: string; end: string }): string {
  const lines = [
    csvCell(`Payroll reconciliation ${period.start} to ${period.end} (counts only; no client information)`),
    RECONCILIATION_CSV_COLUMNS.map(csvCell).join(','),
  ];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.role,
        r.homebaseLinked ? 'Yes' : 'No',
        r.clockedHours,
        r.clockedDays,
        r.openTimecards,
        r.completedVisits,
        r.scheduledVisits,
        r.scheduledVisitMinutes,
        r.signedNotes,
        r.unsignedNotes,
        r.unsignedPastDue,
        r.visitDaysWithoutClockIn.join(' '),
        r.clockedDaysWithoutVisits.join(' '),
        r.flags.join(' '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export const RECON_FLAG_TEXT: Record<ReconciliationFlag, string> = {
  unsigned_notes_before_payroll: 'Unsigned notes past due',
  visits_without_clock_in: 'Visits on days with no clock-in',
  clocked_days_without_visits: 'Clocked days with no visits',
  not_linked_to_homebase: 'Not linked to Homebase',
  open_timecards: 'Open timecards (no clock-out)',
};
