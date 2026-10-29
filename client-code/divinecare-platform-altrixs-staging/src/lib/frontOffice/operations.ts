import 'server-only';
/**
 * Office manager operations view (server): front-office readiness across locations for the next
 * days, the exceptions queue, waitlist fill opportunities for cancelled slots, unsigned notes past
 * the deadline (counts by clinician), staff invites not accepted and open front-desk work.
 * Counts and appointment references only; no clinical content.
 */
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { loadAppointmentNoteStatuses } from '@/lib/analytics/visitDocumentationServer';
import { practiceNoteSignDeadlineHours } from '@/lib/practice/consumers';
import { rankWaitlist } from '@/lib/scheduling/waitlistSuggest';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { loadFrontOfficeDay, type FoViewer } from './loader';
import { exceptionQueue, rollupByLocation, unsignedByClinician, type ExceptionGroup, type LocationRollup } from './operationsCore';
import { FO_VISIT_KIND, isOpen } from './rules';
import type { FoDaySummary } from './types';

export type WaitlistOpportunity = {
  appointmentId: string;
  date: string;
  startTime: string;
  clinicianName: string | null;
  type: string;
  matches: number;
};

export type FrontOfficeOperations = {
  today: string;
  dates: string[];
  locationId: string | null;
  rollup: { date: string; locations: LocationRollup[] }[];
  summaries: FoDaySummary[];
  exceptions: ExceptionGroup[];
  waitlist: { waiting: number; openSlots: WaitlistOpportunity[] };
  unsignedNotes: { deadlineHours: number; total: number; byClinician: { clinicianName: string; count: number; oldestDays: number }[] };
  staff: { invitedNotActive: number };
  openFrontDeskTasks: { openItems: number; deferred: number };
};

const LOOKBACK_DAYS = 30;

export async function loadFrontOfficeOperations(viewer: FoViewer, opts: { locationId?: string | null; days?: number; now?: Date } = {}): Promise<FrontOfficeOperations> {
  const now = opts.now ?? new Date();
  const org = viewer.organizationId;
  const days = Math.max(1, Math.min(7, opts.days ?? 7));
  const day = await loadFrontOfficeDay(viewer, { days, locationId: opts.locationId ?? null, now });
  const tz = day.timeZone;

  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const windowEnd = new Date(now.getTime() + days * 86_400_000);
  const [deadlineHours, pastVisits, cancelled, waitingEntries, invited, deferred] = await Promise.all([
    practiceNoteSignDeadlineHours(org),
    prisma.appointment.findMany({
      where: { AND: [appointmentOrgWhere(org), { status: { in: ['COMPLETED', 'CHECKED_IN', 'IN_SESSION'] }, startsAt: { gte: since, lt: now } }] },
      select: { id: true, endsAt: true, clinicianName: true, clinician: { select: { name: true } } },
      take: 5000,
    }),
    prisma.appointment.findMany({
      where: { AND: [appointmentOrgWhere(org), { status: { in: ['CANCELLED', 'LATE_CANCEL'] }, startsAt: { gt: now, lt: windowEnd } }] },
      select: { id: true, clinicianId: true, clinicianName: true, type: true, startsAt: true, endsAt: true, clinician: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 200,
    }),
    prisma.waitlistEntry.findMany({
      where: { organizationId: org, status: 'WAITING' },
      select: { id: true, name: true, urgency: true, specialty: true, clinicianId: true, createdAt: true },
      take: 300,
    }),
    prisma.user.count({ where: { organizationId: org, status: 'INVITED' } }),
    prisma.visitChecklistItem.count({ where: { organizationId: org, visitKind: FO_VISIT_KIND, status: 'deferred', markedAt: { gte: since } } }),
  ]);

  // Unsigned notes past due, by clinician (counts only)
  const noteStatus = await loadAppointmentNoteStatuses(pastVisits.map((v) => v.id));
  const byClinician = unsignedByClinician(
    pastVisits.map((v) => ({ clinicianName: v.clinicianName?.trim() || v.clinician?.name || null, endsAt: v.endsAt, signed: noteStatus.get(v.id) === 'SIGNED' })),
    deadlineHours,
    now
  );

  // Cancelled slots not refilled (no live visit of the same clinician overlapping) with waitlist matches
  const live = cancelled.length
    ? await prisma.appointment.findMany({
        where: {
          AND: [
            appointmentOrgWhere(org),
            { clinicianId: { in: [...new Set(cancelled.map((c) => c.clinicianId).filter((x): x is string => Boolean(x)))] } },
            { status: { notIn: ['CANCELLED', 'LATE_CANCEL', 'NO_SHOW'] }, startsAt: { gt: now, lt: windowEnd } },
          ],
        },
        select: { clinicianId: true, startsAt: true, endsAt: true },
      })
    : [];
  const openSlots: WaitlistOpportunity[] = [];
  for (const c of cancelled) {
    const refilled = live.some((l) => l.clinicianId === c.clinicianId && l.startsAt < c.endsAt && l.endsAt > c.startsAt);
    if (refilled) continue;
    const matches = rankWaitlist(waitingEntries, { id: c.id, clinicianId: c.clinicianId, type: c.type, startsAt: c.startsAt }, 50).length;
    const wall = toPracticeWallTime(c.startsAt, tz);
    openSlots.push({ appointmentId: c.id, date: wall.date, startTime: wall.time, clinicianName: c.clinicianName?.trim() || c.clinician?.name || null, type: c.type, matches });
  }

  const nearDates = day.dates.slice(0, 2);
  return {
    today: day.today,
    dates: day.dates,
    locationId: day.locationId,
    rollup: nearDates.map((d) => ({ date: d, locations: rollupByLocation(day.rows, d) })),
    summaries: day.summaries,
    exceptions: exceptionQueue(day.rows, day.today),
    waitlist: { waiting: waitingEntries.length, openSlots: openSlots.filter((s) => s.matches > 0).concat(openSlots.filter((s) => s.matches === 0)).slice(0, 20) },
    unsignedNotes: { deadlineHours, total: byClinician.reduce((t, c) => t + c.count, 0), byClinician: byClinician.slice(0, 15) },
    staff: { invitedNotActive: invited },
    openFrontDeskTasks: {
      openItems: day.rows.filter((r) => nearDates.includes(r.date)).reduce((t, r) => t + r.items.filter((x) => isOpen(x) && x.level === 'required').length, 0),
      deferred,
    },
  };
}
