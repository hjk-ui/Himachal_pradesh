/**
 * Which appointments the clinician "Today" panel reads (no I/O; tested). The viewer's OWN visits
 * on today's practice-clock window, for clients they may open under the existing caseload rules
 * (clientAccessWhere: assigned / care team / Medical Director), never cancelled visits.
 */
import type { Prisma, Role } from '@prisma/client';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export type TodayViewer = { organizationId: string; userId: string; role: Role };

export function todayAppointmentWhere(viewer: TodayViewer, window: { start: Date; end: Date }): Prisma.AppointmentWhereInput {
  return {
    AND: [
      appointmentOrgWhere(viewer.organizationId),
      { clinicianId: viewer.userId },
      { client: clientAccessWhere({ organizationId: viewer.organizationId, actorUserId: viewer.userId, actorRole: viewer.role }) },
      { startsAt: { gte: window.start, lt: window.end } },
      { status: { not: 'CANCELLED' } },
    ],
  };
}
