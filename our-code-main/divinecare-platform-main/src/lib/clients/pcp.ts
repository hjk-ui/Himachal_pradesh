/**
 * Primary care provider (PCP) on the care team (Oct 25).
 * The PCP is the care-team member whose role is "Primary care". One per client.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PCP_ROLE_LABEL, slotForRoleText } from '@/lib/clients/careTeamSummary';
import { syncTreatmentTeamJson } from '@/lib/clients/careTeam';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { limitPrimaryCareToOwnLocations } from '@/lib/clients/locationScope';

/** Staff roles that can be a client's PCP. */
export const PCP_ELIGIBLE_ROLES: readonly Role[] = ['PHYSICIAN', 'MEDICAL_NP'];

/**
 * Keep Client.treatmentTeam in step with the PCP row without changing its shape: the 5-slot object
 * (which also carries copay and the warm-handoff ids) only gains primaryCareId / primaryCareName;
 * the member-array form is re-synced from the rows as the other care-team routes do.
 */
async function mirrorPcpToTeamJson(clientId: string, pcp: { id: string; name: string }) {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: { treatmentTeam: true } });
  const team = row?.treatmentTeam;
  if (team && typeof team === 'object' && !Array.isArray(team)) {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        treatmentTeam: { ...(team as Prisma.JsonObject), primaryCareId: pcp.id, primaryCareName: pcp.name },
      },
    });
    return;
  }
  await syncTreatmentTeamJson(clientId);
}

export type SetPcpResult =
  | { ok: true; member: { id: string; providerId: string | null; name: string }; replaced: boolean }
  | { ok: false; status: number; error: string };

export async function setClientPcp(input: {
  clientId: string;
  providerId: string;
  actor: { id: string; role: Role; organizationId: string };
}): Promise<SetPcpResult> {
  const { clientId, providerId, actor } = input;

  const where = await limitPrimaryCareToOwnLocations(
    clientAccessWhere({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      actorRole: actor.role,
    }),
    actor
  );
  const client = await prisma.client.findFirst({
    where: { id: clientId, AND: [where] },
    select: { id: true },
  });
  if (!client) return { ok: false, status: 404, error: 'Client not found' };

  const provider = await prisma.user.findFirst({
    where: { id: providerId, organizationId: actor.organizationId, status: 'ACTIVE' },
    select: { id: true, name: true, role: true, roles: true },
  });
  if (!provider) return { ok: false, status: 404, error: 'Provider not found' };
  const eligible = [provider.role, ...provider.roles].some((r) => PCP_ELIGIBLE_ROLES.includes(r));
  if (!eligible || !provider.name) {
    return { ok: false, status: 400, error: 'Only a physician or medical NP can be set as PCP' };
  }

  const members = await prisma.clientTreatmentTeamMember.findMany({ where: { clientId } });
  const existingForProvider = members.find((m) => m.providerId === provider.id);
  if (existingForProvider && slotForRoleText(existingForProvider.role) !== 'primaryCare') {
    return {
      ok: false,
      status: 409,
      error: `${provider.name} is already on this care team as ${existingForProvider.role}.`,
    };
  }

  const previousPcps = members.filter(
    (m) => slotForRoleText(m.role) === 'primaryCare' && m.id !== existingForProvider?.id
  );

  const member = await prisma.$transaction(async (tx) => {
    if (previousPcps.length > 0) {
      await tx.clientTreatmentTeamMember.deleteMany({
        where: { id: { in: previousPcps.map((m) => m.id) } },
      });
    }
    if (existingForProvider) return existingForProvider;
    return tx.clientTreatmentTeamMember.create({
      data: {
        clientId,
        providerId: provider.id,
        name: provider.name!,
        role: PCP_ROLE_LABEL,
        isPrimary: previousPcps.some((m) => m.isPrimary),
        assignedBy: actor.id,
      },
    });
  });

  await mirrorPcpToTeamJson(clientId, { id: member.providerId ?? member.id, name: member.name });
  return {
    ok: true,
    member: { id: member.id, providerId: member.providerId, name: member.name },
    replaced: previousPcps.length > 0,
  };
}
