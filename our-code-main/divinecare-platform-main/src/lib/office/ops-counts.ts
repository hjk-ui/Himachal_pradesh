import { prisma } from '@/lib/db/prisma';
import { clinicDate, addCalendarDays } from '@/lib/workflows/dates';

export type OpsCountCard = {
  id: string;
  label: string;
  count: number;
  href: string;
};

function dayBounds(day: string) {
  return {
    start: new Date(`${day}T00:00:00.000Z`),
    end: new Date(`${day}T23:59:59.999Z`),
  };
}

/** Counts only — deep-link into existing pages. No PHI payloads. */
export async function buildOfficeOpsCounts(organizationId: string): Promise<OpsCountCard[]> {
  const today = clinicDate();
  const tomorrow = addCalendarDays(today, 1);
  const todayB = dayBounds(today);
  const tomorrowB = dayBounds(tomorrow);

  const [
    todayAppts,
    tomorrowAppts,
    waitlist,
    invites,
    draftNotes,
    paymentsToday,
  ] = await Promise.all([
    prisma.appointment.count({
      where: { organizationId, startsAt: { gte: todayB.start, lte: todayB.end } },
    }),
    prisma.appointment.count({
      where: { organizationId, startsAt: { gte: tomorrowB.start, lte: tomorrowB.end } },
    }),
    prisma.waitlistEntry
      .count({ where: { organizationId, status: 'WAITING' } })
      .catch(() => 0),
    prisma.user.count({ where: { organizationId, status: 'INVITED' } }).catch(() => 0),
    // ProgressNoteWorkflow has clientId but no client relation — scope via ProgressNote → Client.
    prisma.progressNote
      .count({
        where: {
          client: { organizationId },
          workflow: {
            status: 'DRAFT',
            createdAt: { lt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
          },
        },
      })
      .catch(() => 0),
    prisma.payment
      .count({
        where: {
          organizationId,
          paidAt: { gte: todayB.start, lte: todayB.end },
          method: { in: ['CARD', 'CASH', 'CHECK'] },
        },
      })
      .catch(() => 0),
  ]);

  const exceptions = await prisma.appointment
    .count({
      where: {
        organizationId,
        startsAt: { gte: todayB.start, lte: todayB.end },
        status: { in: ['NO_SHOW', 'LATE_CANCEL', 'CANCELLED'] },
      },
    })
    .catch(() => 0);

  const openFdWork = await prisma.appointment
    .count({
      where: {
        organizationId,
        startsAt: { gte: todayB.start, lte: todayB.end },
        status: 'SCHEDULED',
      },
    })
    .catch(() => 0);

  return [
    {
      id: 'readiness_today',
      label: 'Readiness — today',
      count: todayAppts,
      href: '/dashboard/appointments',
    },
    {
      id: 'readiness_tomorrow',
      label: 'Readiness — tomorrow',
      count: tomorrowAppts,
      href: '/dashboard/appointments',
    },
    {
      id: 'exceptions',
      label: 'Exceptions queue',
      count: exceptions,
      href: '/dashboard/appointments',
    },
    {
      id: 'waitlist',
      label: 'Waitlist fill opportunities',
      count: waitlist,
      href: '/dashboard/clients/waitlist',
    },
    {
      id: 'notes_past_deadline',
      label: 'Notes past signing deadline',
      count: draftNotes,
      href: '/dashboard/ehr/notes',
    },
    {
      id: 'invites',
      label: 'Staff invites not accepted',
      count: invites,
      href: '/dashboard/hr',
    },
    {
      id: 'open_fd',
      label: 'Open front-desk work',
      count: openFdWork,
      href: '/dashboard/appointments',
    },
    {
      id: 'copay_recon',
      label: "Today's copay reconciliation",
      count: paymentsToday,
      href: '/dashboard/billing/payments',
    },
  ];
}
