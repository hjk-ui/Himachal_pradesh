import { prisma } from '@/lib/db/prisma';
import { clinicDate, addCalendarDays } from '@/lib/workflows/dates';
import {
  HUDDLE_CHECKLIST_LABELS,
  HUDDLE_EOD_TILES,
  readinessBadgeText,
  readinessFromDone,
  type HuddleEodTileId,
  type HuddleTab,
} from './huddle-checklist';

export type HuddleAppointmentRow = {
  id: string;
  clientName: string;
  startsAt: string;
  status: string;
  isVirtual: boolean;
  checklist: Array<{ label: string; done: boolean }>;
  readiness: string;
  remaining: number;
  href: string;
};

function dayBounds(day: string) {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  return { start, end };
}

function isCancelled(status: string) {
  const s = status.toUpperCase();
  return s.includes('CANCEL') || s === 'NO_SHOW' || s === 'LATE_CANCEL';
}

export async function buildFrontDeskHuddle(
  organizationId: string,
  tab: HuddleTab
): Promise<{
  tab: HuddleTab;
  day: string;
  appointments: HuddleAppointmentRow[];
  eod: Array<{ id: HuddleEodTileId; label: string; count: number }>;
}> {
  const today = clinicDate();
  const day = tab === 'tomorrow' ? addCalendarDays(today, 1) : today;
  const { start, end } = dayBounds(day);

  const appointments = await prisma.appointment.findMany({
    where: {
      organizationId,
      startsAt: { gte: start, lte: end },
    },
    select: {
      id: true,
      clientName: true,
      startsAt: true,
      status: true,
      isVirtual: true,
      noteStatus: true,
      clientId: true,
      client: {
        select: {
          name: true,
          email: true,
          phone: true,
          addressLine1: true,
          insurancePayer: true,
          insuranceMemberId: true,
          patientAccount: { select: { id: true, status: true } },
          consentForms: {
            where: { status: 'SIGNED' },
            select: { type: true, expiresAt: true },
            take: 20,
          },
          eligibilityChecks: {
            orderBy: { checkedAt: 'desc' },
            take: 1,
            select: { status: true },
          },
          priorAuths: {
            where: { status: 'APPROVED' },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
    orderBy: { startsAt: 'asc' },
    take: 200,
  });

  const now = Date.now();
  const rows: HuddleAppointmentRow[] = appointments.map((appt) => {
    const client = appt.client;
    const cancelled = isCancelled(appt.status);
    const consentsOk = (client.consentForms || []).some(
      (c) => !c.expiresAt || c.expiresAt.getTime() > now
    );
    const elig = client.eligibilityChecks[0]?.status || '';
    const eligOk = /active|eligible|verified/i.test(elig);
    const demosOk = Boolean(
      client.addressLine1 && (client.phone || client.email) && client.insurancePayer
    );
    const portalOk = Boolean(client.patientAccount?.id);
    const authOk = (client.priorAuths || []).length > 0;
    const checkedIn = /CHECKED_IN|IN_SESSION|COMPLETED/i.test(appt.status);
    const closed = /COMPLETED/i.test(appt.status);

    const flags: Record<string, boolean> = {
      'Appointment confirmed': !cancelled && appt.status !== 'SCHEDULED' ? true : !cancelled,
      'Eligibility verified': eligOk,
      'Authorization on file': authOk,
      'Demographics complete': demosOk,
      'Consents signed': consentsOk,
      'Intake packet completed': demosOk && consentsOk,
      'Carelon attestation (Medicaid)': false, // none on file unless stored — leave false
      'Balance due': false, // FD sees flag only when payment module marks it — default none
      'Telehealth join link': appt.isVirtual,
      'Portal account': portalOk,
      'Reminder call (high no-show risk)': false,
      'Identity verified': checkedIn,
      'Photo ID and insurance card checked': checkedIn,
      'Copay collected': false,
      'Checked in': checkedIn,
      'Next appointment booked': false,
      'Visit documents given/sent': closed,
      'Visit closed': closed,
      'Rescheduled': /RESCHEDULE/i.test(appt.status),
      'Outreach logged': false,
    };

    const checklist = HUDDLE_CHECKLIST_LABELS.map((label) => ({
      label,
      done: Boolean(flags[label]),
    }));
    const doneCount = checklist.filter((c) => c.done).length;
    const remaining = checklist.length - doneCount;
    const ready = readinessFromDone(doneCount, checklist.length, cancelled);

    return {
      id: appt.id,
      clientName: appt.clientName || client.name || 'Patient',
      startsAt: appt.startsAt.toISOString(),
      status: appt.status,
      isVirtual: appt.isVirtual,
      checklist,
      readiness: readinessBadgeText(ready, remaining),
      remaining,
      href: `/dashboard/appointments?focus=${appt.id}`,
    };
  });

  // EOD tiles for today (always computed for end_of_day tab; cheap for others)
  const todayBounds = dayBounds(today);
  const todayAppts = await prisma.appointment.findMany({
    where: {
      organizationId,
      startsAt: { gte: todayBounds.start, lte: todayBounds.end },
    },
    select: { status: true, noteStatus: true, id: true, clientId: true },
  });

  const seen = todayAppts.filter((a) => /COMPLETED|CHECKED_IN|IN_SESSION/i.test(a.status)).length;
  const noShows = todayAppts.filter((a) => /NO_SHOW|LATE_CANCEL/i.test(a.status)).length;
  const notClosed = todayAppts.filter(
    (a) => !/COMPLETED|CANCELLED|NO_SHOW|LATE_CANCEL/i.test(a.status)
  ).length;
  const notesNotSigned = todayAppts.filter((a) => a.noteStatus !== 'SIGNED').length;

  let copaysPosted = 0;
  let copaysNotPosted = 0;
  try {
    const payments = await prisma.payment.count({
      where: {
        organizationId,
        paidAt: { gte: todayBounds.start, lte: todayBounds.end },
        method: { in: ['CARD', 'CASH', 'CHECK'] },
      },
    });
    copaysPosted = payments;
    copaysNotPosted = Math.max(0, seen - payments);
  } catch {
    copaysPosted = 0;
    copaysNotPosted = 0;
  }

  const eodCounts: Record<HuddleEodTileId, number> = {
    seen,
    no_shows: noShows,
    not_closed: notClosed,
    notes_not_signed: notesNotSigned,
    copays_posted: copaysPosted,
    copays_not_posted: copaysNotPosted,
  };

  return {
    tab,
    day,
    appointments: tab === 'end_of_day' ? [] : rows,
    eod: HUDDLE_EOD_TILES.map((t) => ({ ...t, count: eodCounts[t.id] })),
  };
}
