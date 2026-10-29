import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { APPOINTMENT_TYPES } from '@/features/appointments/types';
import { PatientAppError, type PatientContext } from '@/patient/domain';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { serializePatientAppointment } from '@/patient/application/appointments/mapper';

async function getOwnAppointment(clientId: string, appointmentId: string) {
  return prisma.appointment.findFirst({
    where: { id: appointmentId, clientId },
    include: { clinician: { select: { id: true, name: true } } },
  });
}

export async function listPatientAppointments(
  clientId: string,
  opts: { includePast?: boolean; includeCancelled?: boolean } = {}
) {
  const where: Prisma.AppointmentWhereInput = {
    clientId,
    ...(opts.includeCancelled
      ? (opts.includePast ? {} : { endsAt: { gte: new Date() } })
      : {
          status: opts.includePast
            ? { notIn: ['CANCELLED', 'LATE_CANCEL'] }
            : { notIn: ['CANCELLED', 'LATE_CANCEL', 'COMPLETED', 'NO_SHOW'] },
          ...(opts.includePast ? {} : { endsAt: { gte: new Date() } }),
        }),
  };

  const rows = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: { clinician: { select: { id: true, name: true } } },
  });
  return rows.map(serializePatientAppointment);
}

export async function getPatientAppointment(clientId: string, appointmentId: string) {
  const row = await getOwnAppointment(clientId, appointmentId);
  if (!row) {
    throw new PatientAppError('Appointment not found', 404, 'NOT_FOUND');
  }
  return serializePatientAppointment(row);
}

function parseSlot(date: string, startTime: string, endTime?: string | null) {
  const start = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(start.getTime())) {
    throw new PatientAppError('Invalid date or time', 400, 'VALIDATION_ERROR');
  }
  let end: Date;
  if (endTime) {
    end = new Date(`${date}T${endTime}:00`);
  } else {
    end = new Date(start.getTime() + 50 * 60 * 1000);
  }
  if (Number.isNaN(end.getTime()) || end <= start) {
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

async function hasScheduleConflict(
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

  const conflict = await prisma.appointment.findFirst({ where, select: { id: true } });
  return Boolean(conflict);
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
  const { start, end } = parseSlot(input.date, input.startTime, input.endTime);

  if (await hasScheduleConflict(clinician.id, start, end)) {
    throw new PatientAppError('This time slot is no longer available', 409, 'SLOT_UNAVAILABLE');
  }

  const row = await prisma.appointment.create({
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
      createdByName: ctx.clientName,
    },
    include: { clinician: { select: { id: true, name: true } } },
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    action: 'appointment.created',
    entityType: 'appointment',
    entityId: row.id,
  });

  return serializePatientAppointment(row);
}

export async function cancelPatientAppointment(ctx: PatientContext, appointmentId: string) {
  const existing = await getOwnAppointment(ctx.clientId, appointmentId);
  if (!existing) {
    throw new PatientAppError('Appointment not found', 404, 'NOT_FOUND');
  }
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
    throw new PatientAppError('This appointment cannot be cancelled', 400, 'INVALID_STATE');
  }

  const row = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: 'CANCELLED', rescheduleRequestedAt: null, rescheduleNote: null },
    include: { clinician: { select: { id: true, name: true } } },
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    action: 'appointment.cancelled',
    entityType: 'appointment',
    entityId: row.id,
  });

  return serializePatientAppointment(row);
}

export async function reschedulePatientAppointment(
  ctx: PatientContext,
  appointmentId: string,
  input: { date: string; startTime: string; endTime?: string | null; note?: string | null }
) {
  const existing = await getOwnAppointment(ctx.clientId, appointmentId);
  if (!existing) {
    throw new PatientAppError('Appointment not found', 404, 'NOT_FOUND');
  }
  if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
    throw new PatientAppError('This appointment cannot be rescheduled', 400, 'INVALID_STATE');
  }

  const { start, end } = parseSlot(input.date, input.startTime, input.endTime);
  if (existing.clinicianId && (await hasScheduleConflict(existing.clinicianId, start, end, existing.id))) {
    throw new PatientAppError('This time slot is no longer available', 409, 'SLOT_UNAVAILABLE');
  }

  const note = input.note?.trim().slice(0, 500) || null;

  const row = await prisma.appointment.update({
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

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    action: 'appointment.reschedule_requested',
    entityType: 'appointment',
    entityId: row.id,
  });

  return serializePatientAppointment(row);
}

export async function getNextPatientAppointment(clientId: string) {
  const row = await prisma.appointment.findFirst({
    where: {
      clientId,
      endsAt: { gte: new Date() },
      status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION'] },
    },
    orderBy: { startsAt: 'asc' },
    include: { clinician: { select: { id: true, name: true } } },
  });
  return row ? serializePatientAppointment(row) : null;
}
