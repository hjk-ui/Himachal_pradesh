import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';

/**
 * ONE answer to "may this staff member open this client" for per-client gates, the same rule as
 * the client list (orgScope.clientAccessWhere): primary assigned clinician, a member of the
 * client's treatment team, or the clinician on a recent / upcoming appointment (primary care and
 * Peer Support variants as defined there); org-wide roles and a verified Medical Director see the
 * whole organization. Never replaces the Part 2 / sensitive-record lock (assertClientPhiAccess),
 * which callers still apply on top. Reads the database on every call (no cache), so a new
 * assignment or treatment-team row takes effect on the next request.
 */
export type CaseloadActor = { organizationId: string; userId: string; role: Role | string };

/** One exists-query: the client matches clientAccessWhere for this actor. */
export async function isOnCaseload(actor: CaseloadActor, clientId: string): Promise<boolean> {
  if (!clientId || !actor.userId) return false;
  const hit = await prisma.client.findFirst({
    where: {
      AND: [
        { id: clientId },
        clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role }),
      ],
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/**
 * Per-client caseload gate for a client row the caller already loaded in the actor's org.
 * Not caseload-scoped (leadership, front desk, verified Medical Director ...): true. The primary
 * assignee: true without a query. Otherwise the care-team rule (isOnCaseload).
 */
export async function caseloadAllows(
  actor: CaseloadActor,
  client: { id: string; assignedToId?: string | null }
): Promise<boolean> {
  if (!isCaseloadScoped({ role: actor.role, userId: actor.userId, organizationId: actor.organizationId })) return true;
  if (client.assignedToId && client.assignedToId === actor.userId) return true;
  return isOnCaseload(actor, client.id);
}

/** Convenience: true when a caseload-scoped actor is NOT on this client's care team (-> 403). */
export async function caseloadDenies(
  actor: CaseloadActor,
  client: { id: string; assignedToId?: string | null }
): Promise<boolean> {
  return !(await caseloadAllows(actor, client));
}
