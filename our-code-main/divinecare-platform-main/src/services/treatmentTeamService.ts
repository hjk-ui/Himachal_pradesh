/**
 * Treatment Team Management Engine (Commit 7fba6e5)
 * Manages Multi-Disciplinary Team (MDT) memberships with Primary designation guards.
 */

import { prisma } from '@/lib/db/prisma';

export interface AddTeamMemberParams {
  clientId: string;
  providerId: string;
  name: string;
  role: string;
  credentials?: string | null;
  isPrimary?: boolean;
  assignedBy?: string | null;
  avatarColor?: string | null;
  initials?: string | null;
}

export interface RemoveTeamMemberParams {
  clientId: string;
  providerId: string;
}

export async function addTeamMember(params: AddTeamMemberParams) {
  const {
    clientId,
    providerId,
    name,
    role,
    credentials = null,
    isPrimary = false,
    assignedBy = null,
    avatarColor = '#5C2D91',
    initials = null,
  } = params;

  // Rule 1: Prevent duplicate assignment
  const existing = await prisma.clientTreatmentTeamMember.findFirst({
    where: {
      clientId,
      OR: [{ providerId }, { id: providerId }, { name }],
    },
  });

  if (existing) {
    throw new Error("Provider is already a member of this client's treatment team.");
  }

  // Rule 2: If setting as primary, demote existing primary on this client's team
  if (isPrimary) {
    await prisma.clientTreatmentTeamMember.updateMany({
      where: { clientId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const cleanName = name
    .replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?|prof\.?)\s+/i, '')
    .replace(/,\s*.*$/, '')
    .trim();
  const parts = cleanName.split(' ').filter(Boolean);
  const computedInitials =
    initials ||
    (parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : parts[0]
        ? parts[0].slice(0, 2).toUpperCase()
        : 'MD');

  const member = await prisma.clientTreatmentTeamMember.create({
    data: {
      clientId,
      providerId,
      name,
      role,
      credentials,
      isPrimary,
      avatarColor: avatarColor || '#5C2D91',
      initials: computedInitials,
      assignedBy,
    },
  });

  // Sync client.treatmentTeam JSON for backward compatibility
  const allMembers = await prisma.clientTreatmentTeamMember.findMany({
    where: { clientId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  await prisma.client
    .update({
      where: { id: clientId },
      data: {
        treatmentTeam: allMembers.map((m) => ({
          id: m.providerId || m.id,
          name: m.name,
          role: m.role,
          credentials: m.credentials,
          primary: m.isPrimary,
          avatarColor: m.avatarColor,
          initials: m.initials,
        })),
      },
    })
    .catch(() => undefined);

  return member;
}

export async function removeTeamMember(params: RemoveTeamMemberParams) {
  const { clientId, providerId } = params;

  const member = await prisma.clientTreatmentTeamMember.findFirst({
    where: {
      clientId,
      OR: [{ providerId }, { id: providerId }],
    },
  });

  if (!member) {
    throw new Error('Team member not found.');
  }

  // Rule 3: Cannot delete the Primary provider without first designating a new Primary
  if (member.isPrimary) {
    throw new Error(
      'Cannot remove the Primary provider. Designate another team member as Primary first.'
    );
  }

  await prisma.clientTreatmentTeamMember.delete({
    where: { id: member.id },
  });

  const remaining = await prisma.clientTreatmentTeamMember.findMany({
    where: { clientId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  await prisma.client
    .update({
      where: { id: clientId },
      data: {
        treatmentTeam: remaining.map((m) => ({
          id: m.providerId || m.id,
          name: m.name,
          role: m.role,
          credentials: m.credentials,
          primary: m.isPrimary,
          avatarColor: m.avatarColor,
          initials: m.initials,
        })),
      },
    })
    .catch(() => undefined);

  return { success: true, removedId: member.id };
}

export async function getClientTreatmentTeam(clientId: string) {
  const members = await prisma.clientTreatmentTeamMember.findMany({
    where: { clientId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  return members;
}
