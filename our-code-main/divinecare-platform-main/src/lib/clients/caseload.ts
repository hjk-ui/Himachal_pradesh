import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessClientRoster, caseloadMemberWhere, clientAccessWhere } from '@/lib/clients/orgScope';
import { limitPrimaryCareToOwnLocations } from '@/lib/clients/locationScope';

export type CaseloadCounts = {
  /** Everything this user may see (same scope as GET /api/clients) */
  all: number;
  /** Assigned to me OR I am on the care team */
  mine: number;
  /** No assigned clinician and no care-team member */
  unassigned: number;
};

/**
 * Counts only — no PHI. Uses the exact scoping GET /api/clients uses so the
 * numbers on the filter pills always match the rows in the list.
 */
export async function getCaseloadCounts(
  actor: { id: string; role: Role; organizationId: string },
  options: { locationId?: string | null } = {}
): Promise<CaseloadCounts> {
  if (!canAccessClientRoster(actor.role)) return { all: 0, mine: 0, unassigned: 0 };

  const scope = await limitPrimaryCareToOwnLocations(
    clientAccessWhere({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorRole: actor.role,
    }),
    actor
  );

  const and: Prisma.ClientWhereInput[] = [scope];
  const locationId = options.locationId?.trim();
  if (locationId && locationId !== 'all') {
    // Mirrors the list page: clients without a location show everywhere.
    and.push({ OR: [{ locationId }, { locationId: null }] });
  }
  const base: Prisma.ClientWhereInput = { AND: and };

  const [all, mine, unassigned] = await Promise.all([
    prisma.client.count({ where: base }),
    prisma.client.count({ where: { AND: [base, caseloadMemberWhere(actor.id)] } }),
    prisma.client.count({
      where: { AND: [base, { assignedToId: null }, { treatmentTeamMembers: { none: {} } }] },
    }),
  ]);

  return { all, mine, unassigned };
}
