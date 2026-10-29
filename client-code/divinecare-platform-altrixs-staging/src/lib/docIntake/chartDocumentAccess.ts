/**
 * Chart documents (filed DocumentIntake rows): who may see which document type. The pure rules are
 * in src/lib/migration/valantDocuments.ts (canViewChartDocument); this adds the care-team lookup.
 */
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { behavioralCareTeamClientWhere, clientByIdWhere, medicalCareTeamClientWhere } from '@/lib/clients/orgScope';
import { canViewChartDocument, documentAccessClass, IDENTITY_DOC_ROLES } from '@/lib/migration/valantDocuments';

/** Behavioral-health or primary-care care-team link (assigned, treatment team, visit / appointment) */
export async function isOnClientCareTeam(viewer: { userId: string; organizationId: string }, clientId: string): Promise<boolean> {
  const hit = await prisma.client.findFirst({
    where: {
      AND: [
        clientByIdWhere(clientId, viewer.organizationId),
        { OR: [behavioralCareTeamClientWhere(viewer.userId), medicalCareTeamClientWhere(viewer.userId)] },
      ],
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/**
 * A filter for one viewer and one client's documents. The care-team query runs only when an
 * identity document (Patient ID / Demographics) needs it.
 */
export function chartDocumentFilter(viewer: { userId: string; organizationId: string; role: string }, clientId: string) {
  const ehrAccess = canAccessPath(viewer.role, '/dashboard/ehr');
  let careTeam: Promise<boolean> | null = null;
  const onCareTeam = () => (careTeam ??= isOnClientCareTeam(viewer, clientId).catch(() => false));
  return {
    ehrAccess,
    async canView(documentType: string): Promise<boolean> {
      const needsCareTeam =
        documentAccessClass(documentType) === 'identity' && ehrAccess && !IDENTITY_DOC_ROLES.has(String(viewer.role).toUpperCase());
      return canViewChartDocument({ role: viewer.role, documentType, ehrAccess, onCareTeam: needsCareTeam ? await onCareTeam() : false });
    },
  };
}
