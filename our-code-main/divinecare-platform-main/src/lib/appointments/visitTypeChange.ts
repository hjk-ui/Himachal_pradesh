import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { appointmentOrgWhere } from '@/lib/appointments/manage';
import { canAccessClientAppointments, clientAccessWhere } from '@/lib/clients/orgScope';
import {
  BILLED_CLAIM_STATUSES,
  VISIT_TYPE_CATALOG,
  VISIT_TYPE_REASON_MAX,
  evaluateVisitTypeLock,
  findVisitType,
  visitTypeFromVirtual,
} from '@/lib/appointments/visitType';

type Actor = { id: string; role: Role; organizationId: string };

async function loadAppointment(id: string, actor: Actor) {
  if (!canAccessClientAppointments(actor.role)) {
    return { ok: false as const, status: 403, error: 'Not allowed to update appointments' };
  }
  const appt = await prisma.appointment.findFirst({
    where: {
      id,
      AND: [
        appointmentOrgWhere(actor.organizationId),
        // Same caseload scoping as the client list (assigned clinician OR care team).
        {
          client: clientAccessWhere({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            actorRole: actor.role,
          }),
        },
      ],
    },
    select: { id: true, isVirtual: true, noteStatus: true, clientId: true },
  });
  if (!appt) return { ok: false as const, status: 404, error: 'Appointment not found' };

  const billedClaims = await prisma.claim.count({
    where: {
      appointmentId: id,
      OR: [{ status: { in: [...BILLED_CLAIM_STATUSES] } }, { submittedAt: { not: null } }],
    },
  });
  return { ok: true as const, appt, billed: billedClaims > 0 };
}

export async function getVisitType(id: string, actor: Actor) {
  const loaded = await loadAppointment(id, actor);
  if (loaded.ok === false) return loaded;
  const lock = evaluateVisitTypeLock({ noteStatus: loaded.appt.noteStatus, billed: loaded.billed });
  return {
    ok: true as const,
    visitType: visitTypeFromVirtual(loaded.appt.isVirtual),
    catalog: VISIT_TYPE_CATALOG,
    lock,
  };
}

export async function changeVisitType(
  id: string,
  input: { visitType: string; reason?: string | null },
  actor: Actor
) {
  const target = findVisitType(input.visitType);
  if (!target) return { ok: false as const, status: 400, error: 'Choose a valid visit type' };

  const reason = input.reason?.trim() || null;
  if (reason && reason.length > VISIT_TYPE_REASON_MAX) {
    return {
      ok: false as const,
      status: 400,
      error: `Reason must be ${VISIT_TYPE_REASON_MAX} characters or fewer`,
    };
  }

  const loaded = await loadAppointment(id, actor);
  if (loaded.ok === false) return loaded;

  const lock = evaluateVisitTypeLock({ noteStatus: loaded.appt.noteStatus, billed: loaded.billed });
  if (lock.locked) {
    return { ok: false as const, status: 409, error: lock.message, code: lock.code };
  }

  const previous = visitTypeFromVirtual(loaded.appt.isVirtual);
  if (previous.value === target.value) {
    return { ok: true as const, visitType: target, unchanged: true as const };
  }

  const changer = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  await prisma.appointment.update({
    where: { id },
    data: {
      isVirtual: target.isVirtual,
      // An in-person visit has no meeting; Telehealth meetings are provisioned by the telehealth flow.
      ...(target.isVirtual ? {} : { telehealthPlatform: null, joinUrl: null }),
      lastChangedById: actor.id,
      lastChangedByName: changer?.name || null,
      lastChangedAt: new Date(),
    },
  });

  await writeAuditLog({
    action: 'APPOINTMENT_VISIT_TYPE_CHANGED',
    actorUserId: actor.id,
    organizationId: actor.organizationId,
    resourceType: 'Appointment',
    resourceId: id,
    metadata: { from: previous.value, to: target.value, reason },
  });

  return { ok: true as const, visitType: target, unchanged: false as const };
}
