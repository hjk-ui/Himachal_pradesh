import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canPrescribe } from '@/types/roles';

/**
 * Who receives a SUD screener referral alert.
 *
 * Prefers the prescriber (psychiatrist / NP / physician / medical NP) on the client's
 * treatment team — the assigned clinician is often a therapist who cannot act on a
 * medication or level-of-care referral. Falls back to Client.assignedTo.
 */
export type SudAlertRecipient = {
  userId: string;
  name: string;
  roleLabel: string;
  source: 'treatment_team' | 'assigned_clinician';
};

const PRESCRIBER_ROLES: Role[] = ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'];

const ROLE_LABEL: Record<string, string> = {
  PSYCHIATRIST: 'Psychiatrist',
  NP: 'Nurse Practitioner',
  MEDICAL_NP: 'Nurse Practitioner',
  PHYSICIAN: 'Physician',
  THERAPIST: 'Therapist',
  CLINICIAN: 'Clinician',
  CASE_MANAGER: 'Case Manager',
  PRP_SPECIALIST: 'PRP Specialist',
  PEER_SUPPORT: 'Peer Support',
};

export function sudRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Clinician';
  return ROLE_LABEL[role] ?? role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ');
}

const PRESCRIBER_TEAM_ROLE = /psychiat|nurse practitioner|pmhnp|\bnp\b|physician|prescrib/i;

function prescriberRank(role: Role): number {
  if (role === 'PSYCHIATRIST') return 0;
  if (role === 'NP' || role === 'MEDICAL_NP') return 1;
  return 2;
}

export async function resolveSudAlertRecipient(input: {
  organizationId: string;
  clientId: string;
  assignedTo: { id: string; name: string | null; role: Role } | null;
}): Promise<SudAlertRecipient | null> {
  const team = await prisma.clientTreatmentTeamMember.findMany({
    where: { clientId: input.clientId, providerId: { not: null } },
    select: { providerId: true, name: true, role: true, isPrimary: true },
  });

  const providerIds = team.map((m) => m.providerId).filter((id): id is string => Boolean(id));
  if (providerIds.length > 0) {
    const users = await prisma.user.findMany({
      where: {
        id: { in: providerIds },
        organizationId: input.organizationId,
        status: { not: 'DEACTIVATED' },
      },
      select: { id: true, name: true, role: true, roles: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const candidates = team
      .map((m) => {
        const user = m.providerId ? byId.get(m.providerId) : undefined;
        if (!user) return null;
        const prescriberRole =
          (canPrescribe(user.role) ? user.role : undefined) ??
          user.roles.find((r) => PRESCRIBER_ROLES.includes(r));
        // The user's account role is authoritative; the team label only breaks ties.
        if (!prescriberRole) return null;
        return { member: m, user, prescriberRole };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => {
        if (a.member.isPrimary !== b.member.isPrimary) return a.member.isPrimary ? -1 : 1;
        const aLabel = PRESCRIBER_TEAM_ROLE.test(a.member.role) ? 0 : 1;
        const bLabel = PRESCRIBER_TEAM_ROLE.test(b.member.role) ? 0 : 1;
        if (aLabel !== bLabel) return aLabel - bLabel;
        return prescriberRank(a.prescriberRole) - prescriberRank(b.prescriberRole);
      });

    const pick = candidates[0];
    if (pick) {
      return {
        userId: pick.user.id,
        name: pick.user.name?.trim() || pick.member.name,
        roleLabel: sudRoleLabel(pick.prescriberRole),
        source: 'treatment_team',
      };
    }
  }

  if (input.assignedTo) {
    return {
      userId: input.assignedTo.id,
      name: input.assignedTo.name?.trim() || 'Assigned clinician',
      roleLabel: sudRoleLabel(input.assignedTo.role),
      source: 'assigned_clinician',
    };
  }
  return null;
}
