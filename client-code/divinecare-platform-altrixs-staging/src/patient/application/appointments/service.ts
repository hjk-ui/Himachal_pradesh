import type { Prisma } from '@prisma/client';
import { triggerAutopayAfterVisitStatus } from '@/lib/patientPayments/visitTrigger';
import { prisma } from '@/lib/db/prisma';
import { APPOINTMENT_TYPES } from '@/features/appointments/types';
import { PatientAppError, type PatientContext } from '@/patient/domain';
import { logPatientAudit, proxyAuditFields } from '@/patient/infrastructure/persistence/audit';
import { serializePatientAppointment as serializeWithZone } from '@/patient/application/appointments/mapper';
import { fromPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { clinicianLockKey } from '@/lib/appointments/overlap';
import { isLateCancellation, patientCancellationMessage } from '@/lib/scheduling/missedVisitFees';
import type { PortalActor } from '@/patient/domain/proxy-policy';
import { filterForProxy } from '@/patient/application/proxy/visibility';

/** Signed-in viewer (proxy logins do not see appointments a clinician marked confidential). */
type Viewer = { clientId: string; access?: PortalActor | null } | null | undefined;

async function proxyVisible<T extends { id: string }>(viewer: Viewer, rows: T[]): Promise<T[]> {
  if (!viewer?.access?.isProxy) return rows;
  return filterForProxy(viewer, 'appointment', rows, (r) => ({ id: r.id, category: 'administrative' }));
}

/** Serialize on the practice clock of the appointment's org (the server runs in UTC). */
async function serializePatientAppointment(row: Parameters<typeof serializeWithZone>[0]) {
  return serializeWithZone(row, await getPracticeTimeZone(row.organizationId));
}

async function getOwnAppointment(clientId: string, appointmentId: string, viewer?: Viewer) {
  const row = await prisma.appointment.findFirst({
    where: { id: appointmentId, clientId },
    include: { clinician: { select: { id: true, name: true } } },
  });
  if (!row) return null;
  return (await proxyVisible(viewer, [row]))[0] ?? null;
}

export async function listPatientAppointments(clientId: string, opts: { includePast?: boolean; viewer?: Viewer } = {}) {
  const where: Prisma.AppointmentWhereInput = {
    clientId,
    status: opts.includePast
      ? { notIn: ['CANCELLED', 'LATE_CANCEL'] }
      : { notIn: ['CANCELLED', 'LATE_CANCEL', 'COMPLETED', 'NO_SHOW'] },
    ...(opts.includePast ? {} : { endsAt: { gte: new Date() } }),
  };

  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: { clinician: { select: { id: true, name: true } } },
  });
  return Promise.all((await proxyVisible(opts.viewer, rows)).map((row) => serializePatientAppointment(row)));
}

export async function getPatientAppointment(clientId: string, appointmentId: string, viewer?: Viewer) {
  const row = await getOwnAppointment(clientId, appointmentId, viewer);
  if (!row) {
    throw new PatientAppError('Appointment not found', 404, 'NOT_FOUND');
  }
  return serializePatientAppointment(row);
}

/**
 * date + HH:mm from the patient app are PRACTICE wall-clock times. `new Date('…T09:00:00')` read
 * them in the server's zone (UTC), storing a 9:00 AM ET booking as 5:00 AM ET.
 */
export function parseSlot(
  date: string,
  startTime: string,
  endTime: string | null | undefined,
  timeZone: string
) {
  const start = fromPracticeWallTime(date, startTime, timeZone);
  if (!start) {
    throw new PatientAppError('Invalid date or time', 400, 'VALIDATION_ERROR');
  }
  let end: Date | null;
  if (endTime) {
    end = fromPracticeWallTime(date, endTime, timeZone);
  } else {
    end = new Date(start.getTime() + 50 * 60 * 1000);
  }
  if (!end || end <= start) {
    throw new PatientAppError('End time must be after start time', 400, 'VALIDATION_ERROR');
  }
  if (start.getTime() < Date.now() - 60_000) {
    throw new PatientAppError('Cannot book in the past', 400, 'VALIDATION_ERROR');
  }
  return { start, end };
}

async function assertClinicianInOrg(clinicianId: string, organizationId: string) {
  const clinician = await prisma.user.findFirst({
    where: {
      id: clinicianId,
      organizationId,
      status: 'ACTIVE',
      role: { in: ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'ADMIN', 'DIRECTOR'] },
    },
    select: { id: true, name: true },
  });
  if (!clinician) {
    throw new PatientAppError('Clinician not available', 400, 'VALIDATION_ERROR');
  }
  return clinician;
}

type ConflictDb = Pick<Prisma.TransactionClient, 'appointment'>;

async function hasScheduleConflict(
  db: ConflictDb,
  clinicianId: string,
  start: Date,
  end: Date,
  excludeId?: string
) {
  const where: Prisma.AppointmentWhereInput = {
    clinicianId,
    status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
    startsAt: { lt: end },
    endsAt: { gt: start },
  };
  if (excludeId) where.id = { not: excludeId };

  const conflict = await db.appointment.findFirst({ where, select: { id: true } });
  return Boolean(conflict);
}

const SLOT_TAKEN = () => new PatientAppError('This time slot is no longer available', 409, 'SLOT_UNAVAILABLE');

/** Practice cancellation window (Practice settings > Billing); 24 h when not set / not migrated. */
async function cancellationWindowHours(organizationId: string | null | undefined): Promise<number> {
  if (!organizationId) return 24;
  try {
    const row = await prisma.practiceSettings.findUnique({ where: { organizationId }, select: { cancellationWindowHours: true } });
    return row?.cancellationWindowHours ?? 24;
  } catch {
    return 24;
  }
}

export async function createPatientAppointment(
  ctx: PatientContext,
  input: {
    clinicianId: string;
    type: string;
    date: string;
    startTime: string;
    endTime?: string | null;
    isVirtual?: boolean;
  }
) {
  const type = input.type.trim();
  if (!type || !APPOINTMENT_TYPES.includes(type as (typeof APPOINTMENT_TYPES)[number])) {
    throw new PatientAppError('Invalid appointment type', 400, 'VALIDATION_ERROR', {
      type: 'Choose a valid appointment type',
    });
  }

  const clinician = await assertClinicianInOrg(input.clinicianId, ctx.organizationId);
  const { start, end } = parseSlot(
    input.date,
    input.startTime,
    input.endTime,
    await getPracticeTimeZone(ctx.organizationId)
  );

  // Check + book under a per-clinician advisory lock (same key as staff booking), so two people
  // taking the same opening at once cannot both get it.
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clinicianLockKey(ctx.organizationId, clinician.id)}))`;
    if (await hasScheduleConflict(tx, clinician.id, start, end)) throw SLOT_TAKEN();
    return tx.appointment.create({
      data: {
        organizationId: ctx.organizationId,
        clientId: ctx.clientId,
        clientName: ctx.clientName,
        clinicianId: clinician.id,
        clinicianName: clinician.name,
        type,
        startsAt: start,
        endsAt: end,
        status: 'SCHEDULED',
        isVirtual: Boolean(input.isVirtual),
        patientBooked: true,
        createdVia: 'portal',
      },
      include: { clinician: { select: { id: true, name: true } } },
    });
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId, ...proxyAuditFields(ctx),
    action: 'appointment.created',
    entityType: 'appointment',
    entityId: row.id,
  });

  return serializePatientAppointment(row);
}

export async function cancelPatientAppointment(ctx: PatientContext, appointmentId: string) {
  const existing = await getOwnAppointment(ctx.clientId, appointmentId, ctx);
  if (!existing) {
    throw new PatientAppError('Appointment not found', 404, 'NOT_FOUND');
  }
  if (existing.status !== 'SCHEDULED' && existing.status !== 'CHECKED_IN') {
    throw new PatientAppError('This appointment cannot be cancelled', 400, 'INVALID_STATE');
  }

  // Inside the practice cancellation window -> LATE_CANCEL (no fee is charged: fee posting does not
  // exist, and Medicaid / PBHS patients are never charged; see src/lib/scheduling/missedVisitFees.ts).
  const windowHours = await cancellationWindowHours(existing.organizationId ?? ctx.organizationId);
  const late = isLateCancellation(existing.startsAt, new Date(), windowHours);

  const row = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: late ? 'LATE_CANCEL' : 'CANCELLED', rescheduleRequestedAt: null, rescheduleNote: null },
    include: { clinician: { select: { id: true, name: true } } },
  });
  void triggerAutopayAfterVisitStatus(row.id, row.status, { userId: null, role: 'PATIENT' });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId, ...proxyAuditFields(ctx),
    action: late ? 'appointment.late_cancelled' : 'appointment.cancelled',
    entityType: 'appointment',
    entityId: row.id,
  });

  return {
    ...(await serializePatientAppointment(row)),
    lateCancel: late,
    cancellationMessage: patientCancellationMessage(late, windowHours),
  };
}

export async function reschedulePatientAppointment(
  ctx: PatientContext,
  appointmentId: string,
  input: { date: string; startTime: string; endTime?: string | null; note?: string | null }
) {
  const existing = await getOwnAppointment(ctx.clientId, appointmentId, ctx);
  if (!existing) {
    throw new PatientAppError('Appointment not found', 404, 'NOT_FOUND');
  }
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
    throw new PatientAppError('This appointment cannot be rescheduled', 400, 'INVALID_STATE');
  }

  const { start, end } = parseSlot(
    input.date,
    input.startTime,
    input.endTime,
    await getPracticeTimeZone(existing.organizationId ?? ctx.organizationId)
  );
  const note = input.note?.trim().slice(0, 500) || null;
  const orgId = existing.organizationId ?? ctx.organizationId;

  const row = await prisma.$transaction(async (tx) => {
    if (existing.clinicianId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clinicianLockKey(orgId, existing.clinicianId)}))`;
      if (await hasScheduleConflict(tx, existing.clinicianId, start, end, existing.id)) throw SLOT_TAKEN();
    }
    return tx.appointment.update({
      where: { id: existing.id },
      data: {
        startsAt: start,
        endsAt: end,
        rescheduleRequestedAt: new Date(),
        rescheduleNote: note,
        patientBooked: true,
      },
      include: { clinician: { select: { id: true, name: true } } },
    });
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId, ...proxyAuditFields(ctx),
    action: 'appointment.reschedule_requested',
    entityType: 'appointment',
    entityId: row.id,
  });

  return serializePatientAppointment(row);
}

export async function getNextPatientAppointment(clientId: string, viewer?: Viewer) {
  const rows = await prisma.appointment.findMany({
    where: {
      clientId,
      endsAt: { gte: new Date() },
      status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION'] },
    },
    orderBy: { startsAt: 'asc' },
    include: { clinician: { select: { id: true, name: true } } },
    take: viewer?.access?.isProxy ? 20 : 1,
  });
  const row = (await proxyVisible(viewer, rows))[0];
  return row ? serializePatientAppointment(row) : null;
}
