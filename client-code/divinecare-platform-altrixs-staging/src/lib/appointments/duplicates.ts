import type { AppointmentStatus, Prisma } from '@prisma/client';
import { clientOrgFilter } from '@/lib/clients/orgScope';

/**
 * Same-slot duplicate guard for staff bookings: one live appointment per
 * org + client + clinician + startsAt. Cancelled / late-cancelled rows do not count, so a
 * cancelled slot can be rebooked. On edit the appointment being edited is excluded (self).
 */
export const CANCELLED_APPOINTMENT_STATUSES: AppointmentStatus[] = ['CANCELLED', 'LATE_CANCEL'];

export const DUPLICATE_APPOINTMENT_CODE = 'DUPLICATE_APPOINTMENT' as const;

export type DuplicateKey = {
  organizationId: string;
  clientId: string;
  clinicianId: string;
  startsAt: Date;
  /** The appointment being edited; never counts as its own duplicate. */
  excludeId?: string | null;
};

/** Appointments in this org: stamped org id, or legacy rows whose client is in the org. */
export function appointmentOrgWhere(organizationId: string): Prisma.AppointmentWhereInput {
  return {
    OR: [{ organizationId }, { client: clientOrgFilter(organizationId) }],
  };
}

export function duplicateAppointmentWhere(key: DuplicateKey): Prisma.AppointmentWhereInput {
  const and: Prisma.AppointmentWhereInput[] = [
    appointmentOrgWhere(key.organizationId),
    {
      clientId: key.clientId,
      clinicianId: key.clinicianId,
      startsAt: key.startsAt,
      status: { notIn: CANCELLED_APPOINTMENT_STATUSES },
    },
  ];
  if (key.excludeId) and.push({ id: { not: key.excludeId } });
  return { AND: and };
}

type DuplicateDb = {
  appointment: {
    findFirst(args: {
      where: Prisma.AppointmentWhereInput;
      select: { id: true };
      orderBy: { createdAt: 'asc' };
    }): Promise<{ id: string } | null>;
  };
};

/** Oldest live appointment already holding this client + clinician + start, or null. */
export async function findDuplicateAppointment(db: DuplicateDb, key: DuplicateKey) {
  return db.appointment.findFirst({
    where: duplicateAppointmentWhere(key),
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Advisory-lock key so two concurrent creates for the same slot serialize (double-click, two tabs). */
export function duplicateLockKey(key: Omit<DuplicateKey, 'excludeId'>) {
  return `appt-slot:${key.organizationId}:${key.clientId}:${key.clinicianId}:${key.startsAt.toISOString()}`;
}

export function duplicateAppointmentFailure(existingId: string) {
  return {
    ok: false as const,
    status: 409,
    code: DUPLICATE_APPOINTMENT_CODE,
    existingId,
    error: 'This client already has an appointment with this clinician at that time.',
  };
}
