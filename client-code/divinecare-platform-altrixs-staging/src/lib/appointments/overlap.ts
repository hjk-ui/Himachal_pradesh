import type { Prisma } from '@prisma/client';
import { CANCELLED_APPOINTMENT_STATUSES, appointmentOrgWhere } from '@/lib/appointments/duplicates';

/**
 * Clinician double-booking guard: any live (not cancelled / late-cancelled) appointment for the
 * same clinician whose time overlaps [start, end). Touching edges (9:00-9:50 then 9:50-10:40) do
 * not overlap. Staff can book over it on purpose (group overflow, crisis add-on) only with a
 * reason; the reason is stored on the appointment (overbookReason) and audited.
 *
 * The exact-duplicate check (same client + clinician + start, duplicates.ts) still runs first and
 * cannot be overridden from the UI.
 */

export const CLINICIAN_OVERLAP_CODE = 'CLINICIAN_OVERLAP' as const;
export const OVERBOOK_REASON_MIN = 5;
export const OVERBOOK_REASON_MAX = 300;

export type OverlapKey = {
  organizationId: string;
  clinicianId: string;
  start: Date;
  end: Date;
  /** Appointments that never conflict with this one (itself on edit; series siblings being moved). */
  excludeIds?: string[];
};

export type OverlapRow = { id: string; startsAt: Date; endsAt: Date };

export function clinicianOverlapWhere(key: OverlapKey): Prisma.AppointmentWhereInput {
  const and: Prisma.AppointmentWhereInput[] = [
    appointmentOrgWhere(key.organizationId),
    {
      clinicianId: key.clinicianId,
      status: { notIn: CANCELLED_APPOINTMENT_STATUSES },
      startsAt: { lt: key.end },
      endsAt: { gt: key.start },
    },
  ];
  if (key.excludeIds?.length) and.push({ id: { notIn: key.excludeIds } });
  return { AND: and };
}

/** Pure check used by series generation against an in-memory list. */
export function overlaps(a: { start: Date; end: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return b.startsAt < a.end && b.endsAt > a.start;
}

type OverlapDb = {
  appointment: {
    findMany(args: {
      where: Prisma.AppointmentWhereInput;
      select: { id: true; startsAt: true; endsAt: true };
      orderBy: { startsAt: 'asc' };
      take: number;
    }): Promise<OverlapRow[]>;
  };
};

export async function findClinicianOverlaps(db: OverlapDb, key: OverlapKey): Promise<OverlapRow[]> {
  return db.appointment.findMany({
    where: clinicianOverlapWhere(key),
    select: { id: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
    take: 10,
  });
}

/** Advisory-lock key: concurrent bookings for one clinician serialize, then re-check. */
export function clinicianLockKey(organizationId: string, clinicianId: string) {
  return `appt-clinician:${organizationId}:${clinicianId}`;
}

export type OverbookInput = { allowOverbook?: boolean | null; overbookReason?: string | null };

/** null = no override; a string = the (trimmed) reason; error when override requested without one. */
export function parseOverbook(input: OverbookInput): { ok: true; reason: string | null } | { ok: false; error: string } {
  if (!input.allowOverbook) return { ok: true, reason: null };
  const reason = (input.overbookReason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < OVERBOOK_REASON_MIN) {
    return { ok: false, error: 'Give a reason for booking over another appointment (at least 5 characters).' };
  }
  return { ok: true, reason: reason.slice(0, OVERBOOK_REASON_MAX) };
}

export function clinicianOverlapFailure(conflicts: OverlapRow[]) {
  return {
    ok: false as const,
    status: 409,
    code: CLINICIAN_OVERLAP_CODE,
    conflictIds: conflicts.map((c) => c.id),
    existingId: conflicts[0]?.id ?? null,
    error:
      'This clinician already has an appointment at that time. Choose another time, or book it anyway with a reason (intentional overbook).',
  };
}
