/**
 * DB-backed inputs for the co-sign authority rule (decideCosignScope / cosignQueueScope in
 * ./transitions.ts): the reviewer's licensure-track supervisees (SupervisionTrack.supervisorId)
 * and whether a client is on the reviewer's caseload (clientAccessWhere). Org-scoped; a missing
 * SupervisionTrack table or a failed lookup fails closed (no supervisees / not on caseload).
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { cosignQueueScope, type CosignQueueScope } from './transitions';

export type CosignActor = { organizationId: string; actorUserId: string; actorRole: Role };

/** User ids this reviewer supervises on a licensure track in this org. */
export async function loadSuperviseeIds(organizationId: string, supervisorId: string): Promise<string[]> {
  try {
    const tracks = await prisma.supervisionTrack.findMany({
      where: { organizationId, supervisorId },
      select: { superviseeId: true },
    });
    return [...new Set(tracks.map((t) => t.superviseeId).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Is this reviewer the designated licensure-track supervisor of any of these authors? */
export async function isDesignatedSupervisorOf(organizationId: string, supervisorId: string, authorIds: string[]): Promise<boolean> {
  const ids = authorIds.filter((id) => id && id !== supervisorId);
  if (!ids.length) return false;
  try {
    const track = await prisma.supervisionTrack.findFirst({
      where: { organizationId, supervisorId, superviseeId: { in: ids } },
      select: { id: true },
    });
    return Boolean(track);
  } catch {
    return false;
  }
}

/** Is this client on the reviewer's caseload (same rule as the chart: clientAccessWhere)? */
export async function isClientOnCaseload(actor: CosignActor, clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false;
  try {
    const row = await prisma.client.findFirst({
      where: { AND: [{ id: clientId }, clientAccessWhere(actor)] },
      select: { id: true },
    });
    return Boolean(row);
  } catch {
    return false;
  }
}

/** Queue scope + inputs for listCosignQueue / listPlansAwaitingCosign. */
export async function loadCosignQueueScope(actor: CosignActor): Promise<{
  scope: CosignQueueScope;
  superviseeIds: string[];
  caseloadClientWhere: Prisma.ClientWhereInput | null;
}> {
  const medicalDirector = verifiedMedicalDirector({ userId: actor.actorUserId, role: actor.actorRole, organizationId: actor.organizationId });
  const scope = cosignQueueScope(actor.actorRole, { medicalDirector });
  if (scope === 'org') return { scope, superviseeIds: [], caseloadClientWhere: null };
  return {
    scope,
    superviseeIds: await loadSuperviseeIds(actor.organizationId, actor.actorUserId),
    caseloadClientWhere: scope === 'supervisees_and_caseload' ? clientAccessWhere(actor) : null,
  };
}
