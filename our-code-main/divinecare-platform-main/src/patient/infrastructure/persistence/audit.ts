import { prisma } from '@/lib/db/prisma';

export async function logPatientAudit(input: {
  clientId: string;
  accountId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
}) {
  try {
    await prisma.patientAuditLog.create({
      data: {
        clientId: input.clientId,
        accountId: input.accountId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });
  } catch {
    // Audit must not break primary flow
  }
}
