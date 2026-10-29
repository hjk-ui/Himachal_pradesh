import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { teamSlotChanges, type SlotTeam } from '@/lib/clients/teamSlots';

export type ScopedActor = {
  organizationId: string;
  userId: string;
  role: Role;
};

/** Client in the actor's org (caseload roles: only their assigned clients), or null. */
export async function findScopedClient(actor: ScopedActor, clientId: string) {
  if (!clientId) return null;
  return prisma.client.findFirst({
    where: {
      id: clientId,
      ...clientAccessWhere({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorRole: actor.role,
      }),
    },
    // assignedToId: care-team changes are for the primary clinician or leadership (canManageCareTeam)
    select: { id: true, assignedToId: true },
  });
}

/** Active staff user of the same org (treatment / care team providers), or null. */
export async function findOrgProvider(organizationId: string, providerId: string) {
  if (!providerId) return null;
  return prisma.user.findFirst({
    where: { id: providerId, organizationId, status: 'ACTIVE' },
    select: { id: true, name: true, role: true },
  });
}

/** Business-rule errors thrown by treatmentTeamService that are safe to show the user. */
const TEAM_RULE_MESSAGES = [
  "Provider is already a member of this client's treatment team.",
  'Team member not found.',
  'Cannot remove the Primary provider. Designate another team member as Primary first.',
];

/** Known rule violation -> its message (400); anything else -> null (log it, return a generic 500). */
export function teamRuleMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : '';
  return TEAM_RULE_MESSAGES.includes(msg) ? msg : null;
}

/**
 * Apply teamSlotChanges: rows for new slot holders (org staff only, one row per provider), and
 * remove the replaced holder's row for that slot role. Errors are logged, never thrown (the
 * profile update already succeeded); returns what changed.
 */
export async function syncTeamSlotsToMembers(input: {
  organizationId: string;
  clientId: string;
  before: SlotTeam;
  after: SlotTeam;
  assignedBy: string;
}): Promise<{ added: string[]; removed: string[] }> {
  const { add, remove } = teamSlotChanges(input.before, input.after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const r of remove) {
    // Still in another slot of the new team: keep their row
    if (add.some((a) => a.providerId === r.providerId)) continue;
    const res = await prisma.clientTreatmentTeamMember
      .deleteMany({ where: { clientId: input.clientId, providerId: r.providerId, role: r.role } })
      .catch((err) => (console.error('[team slots] remove', err instanceof Error ? err.name : 'unknown'), { count: 0 }));
    if (res.count) removed.push(r.providerId);
  }
  for (const a of add) {
    const provider = await findOrgProvider(input.organizationId, a.providerId);
    if (!provider) continue;
    const exists = await prisma.clientTreatmentTeamMember.findFirst({ where: { clientId: input.clientId, providerId: provider.id }, select: { id: true } });
    if (exists) continue;
    await prisma.clientTreatmentTeamMember
      .create({ data: { clientId: input.clientId, providerId: provider.id, name: provider.name || 'Provider', role: a.role, isPrimary: false, assignedBy: input.assignedBy } })
      .then(() => added.push(provider.id))
      .catch((err) => console.error('[team slots] add', err instanceof Error ? err.name : 'unknown'));
  }
  return { added, removed };
}
