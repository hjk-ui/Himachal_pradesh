import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';

const PC_ROLES = new Set(['MEDICAL_ASSISTANT', 'PHYSICIAN', 'MEDICAL_NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

export type MedicalActor = {
  organizationId: string;
  userId: string;
  role: Role;
};

/**
 * Care-team scoped patient access for primary-care APIs.
 * PHYSICIAN / MEDICAL_NP / MEDICAL_ASSISTANT are caseload roles → assigned or treatment-team only.
 */
export async function assertMedicalClientAccess(
  actor: MedicalActor,
  clientId: string
): Promise<{ ok: true } | { ok: false; error: string; status: 403 | 404 }> {
  if (!PC_ROLES.has(actor.role)) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      AND: [clientAccessWhere({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
      })],
    },
    select: { id: true },
  });
  if (!client) return { ok: false, error: 'Patient not found or outside care team', status: 404 };
  return { ok: true };
}

export async function assertMedicalAppointmentAccess(
  actor: MedicalActor,
  appointmentId: string
): Promise<
  | { ok: true; clientId: string; appointmentId: string }
  | { ok: false; error: string; status: 403 | 404 }
> {
  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      OR: [
        { organizationId: actor.organizationId },
        { client: { organizationId: actor.organizationId } },
      ],
    },
    select: { id: true, clientId: true },
  });
  if (!appt) return { ok: false, error: 'Appointment not found', status: 404 };
  const access = await assertMedicalClientAccess(actor, appt.clientId);
  if (access.ok === false) return access;
  return { ok: true, clientId: appt.clientId, appointmentId: appt.id };
}
