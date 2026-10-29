import 'server-only';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { isMedicalRole } from '@/types/roles';
import type { ModuleClientScope } from './clientScope';

export type ModuleScopeActor = { organizationId: string; userId: string; role: Role | string };

/**
 * One query each for: which candidate ids are clients of the org, which of those the caller may open
 * (clientAccessWhere, the caseload / care-team rule), and which are Part 2 / sensitive records the
 * caller may not open (lockedSensitiveClientIds; throws on failure, so callers fail closed).
 */
export async function loadModuleClientScope(actor: ModuleScopeActor, candidateIds: string[]): Promise<ModuleClientScope> {
  const ids = [...new Set(candidateIds.filter(Boolean))];
  const caseloadScoped =
    isCaseloadScoped({ userId: actor.userId, role: actor.role, organizationId: actor.organizationId }) ||
    isMedicalRole(String(actor.role));
  if (!ids.length) return { caseloadScoped, known: new Set(), accessible: new Set(), locked: new Set() };
  const [known, accessible, locked] = await Promise.all([
    prisma.client.findMany({ where: { AND: [{ id: { in: ids } }, clientOrgFilter(actor.organizationId)] }, select: { id: true } }),
    prisma.client.findMany({
      where: {
        AND: [
          { id: { in: ids } },
          clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role }),
        ],
      },
      select: { id: true },
    }),
    lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientIds: ids }),
  ]);
  return {
    caseloadScoped,
    known: new Set(known.map((c) => c.id)),
    accessible: new Set(accessible.map((c) => c.id)),
    locked,
  };
}
