import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientContext, type PatientProfile } from '@/patient/domain';

export async function loadPatientContext(me: PatientProfile): Promise<PatientContext> {
  const client = await prisma.client.findUnique({
    where: { id: me.clientId },
    select: {
      name: true,
      location: { select: { organizationId: true } },
      assignedTo: { select: { id: true, name: true, organizationId: true, status: true } },
    },
  });

  if (!client) {
    throw new PatientAppError('Account not found', 404, 'NOT_FOUND');
  }

  const organizationId =
    client.location?.organizationId ?? client.assignedTo?.organizationId ?? null;

  if (!organizationId) {
    throw new PatientAppError('Clinic not linked to this account', 403, 'NO_ORGANIZATION');
  }

  return {
    ...me,
    clientName: client.name,
    organizationId,
    assignedClinicianId: client.assignedTo?.id ?? null,
    assignedClinicianName: client.assignedTo?.name ?? null,
  };
}
