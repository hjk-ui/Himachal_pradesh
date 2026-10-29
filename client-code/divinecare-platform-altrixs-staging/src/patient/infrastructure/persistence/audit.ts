import { prisma } from '@/lib/db/prisma';

export async function logPatientAudit(input: {
  clientId: string;
  accountId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  /** Proxy context: the PortalAccess link used and the relationship */
  portalAccessId?: string | null;
  relationship?: string | null;
}) {
  try {
    await prisma.patientAuditLog.create({
      data: {
        clientId: input.clientId,
        accountId: input.accountId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        ...(input.portalAccessId ? { portalAccessId: input.portalAccessId } : {}),
        ...(input.relationship ? { relationship: input.relationship } : {}),
      },
    });
  } catch {
    // Audit must not break primary flow
  }
}

/** Audit context of the signed-in person (proxy rows carry the link + relationship). */
export function proxyAuditFields(me: { access?: { accessId: string | null; relationship: string; isProxy: boolean } }) {
  return me.access?.isProxy ? { portalAccessId: me.access.accessId, relationship: me.access.relationship } : {};
}
