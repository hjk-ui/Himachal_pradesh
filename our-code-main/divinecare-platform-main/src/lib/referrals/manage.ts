import type { Role, ReferralDirection, ReferralStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const SOURCE_TYPES = [
  'primary_care',
  'hospital',
  'court',
  'community_event',
  'social_media',
  'word_of_mouth',
  'self',
  'other_provider',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export function canAccessReferrals(role: Role) {
  return canAccessPath(role, '/dashboard/community/referrals');
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

export function serializeReferral(row: {
  id: string;
  direction: ReferralDirection;
  patientName: string;
  sourceType: string;
  sourceName: string;
  referralDate: Date;
  status: ReferralStatus;
  convertedAt: Date | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  const now = new Date();
  return {
    id: row.id,
    direction: row.direction,
    patientName: row.patientName,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    referralDate: ymd(row.referralDate),
    status: row.status,
    convertedAt: row.convertedAt ? ymd(row.convertedAt) : null,
    notes: row.notes,
    daysSinceReferral: daysBetween(row.referralDate, now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CommunityReferralDto = ReturnType<typeof serializeReferral>;

export async function listReferrals(organizationId: string) {
  const rows = await prisma.communityReferral.findMany({
    where: { organizationId },
    orderBy: [{ referralDate: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(serializeReferral);
}

export type CreateReferralInput = {
  direction: 'incoming' | 'outgoing';
  patientName: string;
  sourceType: string;
  sourceName?: string | null;
  referralDate: string;
  notes?: string | null;
};

export async function createReferral(organizationId: string, input: CreateReferralInput) {
  const referralDate = new Date(`${input.referralDate}T12:00:00.000Z`);
  if (Number.isNaN(referralDate.getTime())) {
    return { ok: false as const, status: 400, error: 'Invalid referral date' };
  }
  if (referralDate.getTime() > Date.now() + 86_400_000) {
    return { ok: false as const, status: 400, error: 'Referral date cannot be in the future' };
  }

  const row = await prisma.communityReferral.create({
    data: {
      organizationId,
      direction: input.direction,
      patientName: input.patientName.trim(),
      sourceType: input.sourceType,
      sourceName: input.sourceName?.trim() || input.sourceType,
      referralDate,
      status: 'pending',
      notes: input.notes?.trim() || '',
    },
  });
  return { ok: true as const, referral: serializeReferral(row) };
}

export type UpdateReferralInput = {
  status?: 'pending' | 'accepted' | 'converted' | 'declined';
  notes?: string | null;
};

export async function updateReferral(
  organizationId: string,
  id: string,
  input: UpdateReferralInput
) {
  const existing = await prisma.communityReferral.findFirst({
    where: { id, organizationId },
  });
  if (!existing) {
    return { ok: false as const, status: 404, error: 'Referral not found' };
  }

  const nextStatus = input.status ?? existing.status;
  let convertedAt = existing.convertedAt;
  if (nextStatus === 'converted' && existing.status !== 'converted') {
    convertedAt = new Date();
  }
  if (nextStatus !== 'converted') {
    convertedAt = nextStatus === existing.status ? existing.convertedAt : null;
  }

  const row = await prisma.communityReferral.update({
    where: { id },
    data: {
      status: nextStatus,
      convertedAt,
      notes: input.notes !== undefined ? (input.notes?.trim() || '') : existing.notes,
    },
  });
  return { ok: true as const, referral: serializeReferral(row) };
}
