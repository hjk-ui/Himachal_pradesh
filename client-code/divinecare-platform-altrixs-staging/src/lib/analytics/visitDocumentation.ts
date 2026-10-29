/**
 * Visit documentation metrics (pure, client-safe): sessions = completed appointments; a visit is
 * documented when a linked progress note (ProgressNote.appointmentId) is signed or locked.
 * Timeliness is measured from the visit end to the first signature. No values are invented:
 * a visit without a linked note is "not started", never "signed".
 */
import { DEFAULT_PRACTICE_TIME_ZONE, toPracticeWallTime } from '@/lib/time/practiceTime';

export type VisitNote = { status: 'Draft' | 'Signed' | 'Locked'; signedAt: string | null; lockedAt: string | null };

export type VisitRow = {
  appointmentId: string;
  clinicianId: string | null;
  clinicianName: string | null;
  clinicianRole: string | null;
  clientName: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  notes: VisitNote[];
};

/** Appointment.noteStatus values, derived from the linked ProgressNoteWorkflow rows. */
export type DerivedNoteStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SIGNED';

export function deriveAppointmentNoteStatus(notes: VisitNote[]): DerivedNoteStatus {
  if (notes.some((n) => n.status === 'Signed' || n.status === 'Locked')) return 'SIGNED';
  if (notes.length > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/** Earliest signature (signedAt, else lockedAt) among the visit's signed notes. */
export function visitSignedAt(v: VisitRow): number | null {
  let best: number | null = null;
  for (const n of v.notes) {
    if (n.status !== 'Signed' && n.status !== 'Locked') continue;
    const iso = n.signedAt || n.lockedAt;
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && (best === null || t < best)) best = t;
  }
  return best;
}

function visitEnd(v: VisitRow): number {
  return new Date(v.endsAt || v.startsAt).getTime();
}

export type LateVisit = {
  noteId: string;
  patientName: string;
  sessionDate: string;
  sessionType: string;
  daysOverdue: number;
};

export type ClinicianDocMetrics = {
  clinicianId: string;
  clinicianName: string;
  role: string;
  /** Completed appointments in the window */
  sessions: number;
  signedSameDay: number;
  signedWithin24h: number;
  signedWithin72h: number;
  /** Visits past 72h with no signed note */
  overdue: number;
  /** null when no visit in the window has a signed note */
  avgHoursToSign: number | null;
  /** % of window visits signed within 72h; null when no sessions */
  complianceRate: number | null;
  /** 6 weekly buckets, oldest first: % signed within 72h, null = no sessions that week */
  weeklyTrend: (number | null)[];
  lateNotes: LateVisit[];
};

const H = 3_600_000;
const DAY = 24 * H;

export type ProductivityWindow = { start: number; end: number; now: number; timeZone?: string };

/** Window = the last `days` days ending now (labelled "Last N days" in the UI). */
export function lastDaysWindow(days: number, now = Date.now()): ProductivityWindow {
  return { start: now - days * DAY, end: now, now };
}

export function computeClinicianDocMetrics(visits: VisitRow[], w: ProductivityWindow): ClinicianDocMetrics[] {
  const tz = w.timeZone ?? DEFAULT_PRACTICE_TIME_ZONE;
  const byClinician = new Map<string, VisitRow[]>();
  for (const v of visits) {
    const key = v.clinicianId || 'unassigned';
    const list = byClinician.get(key) ?? [];
    list.push(v);
    byClinician.set(key, list);
  }

  const out: ClinicianDocMetrics[] = [];
  for (const [clinicianId, list] of byClinician) {
    const inWindow = list.filter((v) => {
      const s = new Date(v.startsAt).getTime();
      return s >= w.start && s <= w.end;
    });
    let sameDay = 0;
    let in24 = 0;
    let in72 = 0;
    let signedCount = 0;
    let hoursSum = 0;
    const late: LateVisit[] = [];
    for (const v of inWindow) {
      const end = visitEnd(v);
      const signed = visitSignedAt(v);
      if (signed !== null) {
        const hours = Math.max(0, (signed - end) / H);
        signedCount += 1;
        hoursSum += hours;
        if (toPracticeWallTime(new Date(signed), tz).date === toPracticeWallTime(new Date(end), tz).date) sameDay += 1;
        if (hours <= 24) in24 += 1;
        if (hours <= 72) in72 += 1;
      }
    }
    // Overdue = any loaded visit (whole trend range, not only the window) past 72h with no signed note.
    for (const v of list) {
      const end = visitEnd(v);
      if (visitSignedAt(v) === null && w.now - end > 72 * H) {
        late.push({
          noteId: v.appointmentId,
          patientName: v.clientName,
          sessionDate: toPracticeWallTime(new Date(v.startsAt), tz).date,
          sessionType: v.type,
          daysOverdue: Math.max(1, Math.ceil((w.now - end - 72 * H) / DAY)),
        });
      }
    }

    const weeklyTrend: (number | null)[] = [];
    for (let i = 5; i >= 0; i--) {
      const bEnd = w.now - i * 7 * DAY;
      const bStart = bEnd - 7 * DAY;
      const bucket = list.filter((v) => {
        const s = new Date(v.startsAt).getTime();
        return s > bStart && s <= bEnd;
      });
      if (!bucket.length) {
        weeklyTrend.push(null);
        continue;
      }
      const ok = bucket.filter((v) => {
        const signed = visitSignedAt(v);
        return signed !== null && (signed - visitEnd(v)) / H <= 72;
      }).length;
      weeklyTrend.push(Math.round((ok / bucket.length) * 100));
    }

    if (!inWindow.length && !late.length) continue;
    const first = list[0];
    out.push({
      clinicianId,
      clinicianName: first.clinicianName || 'Unassigned clinician',
      role: first.clinicianRole ? first.clinicianRole.replace(/_/g, ' ') : 'Role not recorded',
      sessions: inWindow.length,
      signedSameDay: sameDay,
      signedWithin24h: in24,
      signedWithin72h: in72,
      overdue: late.length,
      avgHoursToSign: signedCount ? Math.round((hoursSum / signedCount) * 10) / 10 : null,
      complianceRate: inWindow.length ? Math.round((in72 / inWindow.length) * 100) : null,
      weeklyTrend,
      lateNotes: late.sort((a, b) => b.daysOverdue - a.daysOverdue),
    });
  }
  return out;
}
