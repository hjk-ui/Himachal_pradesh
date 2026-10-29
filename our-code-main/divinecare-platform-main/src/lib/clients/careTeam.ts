import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAssignPatientToClinician, clientByIdWhere } from '@/lib/clients/orgScope';

export const CARE_TEAM_CHANGE_DENIED_CODE = 'CARE_TEAM_CHANGE_DENIED';
export const CARE_TEAM_CHANGE_DENIED_MESSAGE =
  'Ask the primary clinician or leadership to change the care team';

export type CareTeamActor = { id: string; role: Role; organizationId: string };

function isLeadership(role: Role | string) {
  const r = String(role).toUpperCase();
  return r === 'DIRECTOR' || canAssignPatientToClinician(r);
}

/** Primary clinician = assigned clinician, or the care-team member flagged primary. */
export async function canChangeCareTeam(clientId: string, actor: CareTeamActor) {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(clientId, actor.organizationId),
    select: {
      assignedToId: true,
      treatmentTeamMembers: { where: { isPrimary: true }, select: { providerId: true } },
    },
  });
  if (!client) return { ok: false as const, status: 404, error: 'Client not found' };

  const isPrimary =
    client.assignedToId === actor.id ||
    client.treatmentTeamMembers.some((m) => m.providerId === actor.id);
  if (isLeadership(actor.role) || isPrimary) return { ok: true as const };

  return {
    ok: false as const,
    status: 403,
    error: CARE_TEAM_CHANGE_DENIED_MESSAGE,
    code: CARE_TEAM_CHANGE_DENIED_CODE,
  };
}

export type CareTeamPatch = {
  memberId: string;
  isPrimary?: boolean;
  role?: string;
  credentials?: string | null;
};

/** Mirror ClientTreatmentTeamMember rows into the legacy Client.treatmentTeam JSON (as POST/DELETE do). */
export async function syncTreatmentTeamJson(clientId: string) {
  const members = await prisma.clientTreatmentTeamMember.findMany({ where: { clientId } });
  await prisma.client
    .update({
      where: { id: clientId },
      data: {
        treatmentTeam: members.map((m) => ({
          id: m.providerId || m.id,
          name: m.name,
          role: m.role,
          credentials: m.credentials,
          primary: m.isPrimary,
        })),
      },
    })
    .catch(() => undefined);
}

export async function updateCareTeamMember(clientId: string, patch: CareTeamPatch) {
  const member = await prisma.clientTreatmentTeamMember.findFirst({
    where: { clientId, OR: [{ id: patch.memberId }, { providerId: patch.memberId }] },
  });
  if (!member) return { ok: false as const, status: 404, error: 'Care team member not found' };

  const updated = await prisma.$transaction(async (tx) => {
    if (patch.isPrimary) {
      await tx.clientTreatmentTeamMember.updateMany({
        where: { clientId, NOT: { id: member.id } },
        data: { isPrimary: false },
      });
    }
    return tx.clientTreatmentTeamMember.update({
      where: { id: member.id },
      data: {
        ...(patch.isPrimary !== undefined ? { isPrimary: patch.isPrimary } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.credentials !== undefined ? { credentials: patch.credentials } : {}),
      },
    });
  });

  await syncTreatmentTeamJson(clientId);
  return { ok: true as const, member: updated };
}
