import type { Role, ReferralDirection, ReferralStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';

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

/** Audit resource type for community referrals (the CREATE row records who logged a referral). */
export const COMMUNITY_REFERRAL_RESOURCE = 'communityReferral';

/**
 * Peer Support and Case Manager see only the referrals they logged or those for clients on their
 * caseload (clientAccessWhere), not every org referral (patient name + notes). Other referral
 * roles (Front Desk, Office Manager, leadership, licensed clinicians...) keep the org list.
 */
export function referralsNeedCaseloadScope(role: Role | string | null | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'PEER_SUPPORT' || r === 'CASE_MANAGER';
}

export function normalizeReferralName(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Pure: a caseload-scoped actor sees a referral they created (CommunityReferral has no creator or
 * client column, so creation comes from the CREATE audit row) or whose patient name exactly
 * matches (case / spacing-insensitive) a client on their caseload.
 */
export function referralVisibleToCaseloadActor(
  referral: { id: string; patientName: string },
  scope: { createdIds: Set<string>; caseloadNames: Set<string> },
): boolean {
  if (scope.createdIds.has(referral.id)) return true;
  const n = normalizeReferralName(referral.patientName);
  return Boolean(n) && scope.caseloadNames.has(n);
}

async function caseloadReferralScope(actor: { organizationId: string; userId: string; role: Role }) {
  const [created, clients] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: 'CREATE',
        resourceType: COMMUNITY_REFERRAL_RESOURCE,
        outcome: 'SUCCESS',
        resourceId: { not: null },
      },
      select: { resourceId: true },
      take: 5000,
    }),
    prisma.client.findMany({
      where: clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role }),
      select: { name: true, legalFirstName: true, legalLastName: true },
    }),
  ]);
  const caseloadNames = new Set<string>();
  for (const c of clients) {
    const display = normalizeReferralName(c.name);
    if (display) caseloadNames.add(display);
    const legal = normalizeReferralName([c.legalFirstName, c.legalLastName].filter(Boolean).join(' '));
    if (legal) caseloadNames.add(legal);
  }
  return { createdIds: new Set(created.map((r) => r.resourceId as string)), caseloadNames };
}

export async function listReferrals(
  organizationId: string,
  actor?: { userId: string; role: Role },
) {
  const rows = await prisma.communityReferral.findMany({
    where: { organizationId },
    orderBy: [{ referralDate: 'desc' }, { createdAt: 'desc' }],
  });
  if (actor && referralsNeedCaseloadScope(actor.role)) {
    const scope = await caseloadReferralScope({ organizationId, ...actor });
    return rows.filter((r) => referralVisibleToCaseloadActor(r, scope)).map(serializeReferral);
  }
  return rows.map(serializeReferral);
}

/** One referral for PATCH: same visibility rule as the list for caseload-scoped roles. */
export async function referralVisibleTo(organizationId: string, id: string, actor: { userId: string; role: Role }) {
  if (!referralsNeedCaseloadScope(actor.role)) return true;
  const row = await prisma.communityReferral.findFirst({ where: { id, organizationId }, select: { id: true, patientName: true } });
  if (!row) return false;
  return referralVisibleToCaseloadActor(row, await caseloadReferralScope({ organizationId, ...actor }));
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
