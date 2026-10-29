import type { MedicalPatient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';

/**
 * One patient record: primary care charts on the Client row. Older MedicalPatient rows are a
 * demographics shadow linked by bhClientId (or the same MRN). This resolves an id from either
 * world to the Client, inside one org, and never creates or merges anything. Unlinked
 * MedicalPatient rows are listed by scripts/medical-patient-reconciliation.ts for a human to match.
 */
export async function resolveMedicalPatientLink(
  organizationId: string,
  idOrMrn: string
): Promise<{ medicalPatient: MedicalPatient | null; clientId: string | null }> {
  const medicalPatient = await prisma.medicalPatient.findFirst({
    where: { organizationId, OR: [{ id: idOrMrn }, { mrn: idOrMrn }] },
  });
  if (medicalPatient) {
    const linkOr: { id?: string; mrn?: string }[] = [{ mrn: medicalPatient.mrn }];
    if (medicalPatient.bhClientId) linkOr.unshift({ id: medicalPatient.bhClientId });
    const client = await prisma.client.findFirst({
      where: { organizationId, OR: linkOr },
      select: { id: true },
    });
    return { medicalPatient, clientId: client?.id ?? null };
  }
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(idOrMrn, organizationId),
    select: { id: true },
  });
  return { medicalPatient: null, clientId: client?.id ?? null };
}
