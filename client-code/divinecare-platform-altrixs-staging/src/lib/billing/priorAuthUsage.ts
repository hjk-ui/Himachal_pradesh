
/**
 * Prior authorization unit accounting. PriorAuth.unitsUsed goes up by the units of the claim lines
 * the auth covers when the claim is sent, and back down when the claim is voided (frequency 8) or
 * denied / rejected. What was counted is kept on the claim (submissionData.priorAuthUsage), so each
 * claim is counted once (a corrected claim, frequency 7, reuses its original count) and released
 * once. Every change is audited.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { authUnitsForLines, type AuthUsage } from './priorAuthMath';

export { authUnitsForLines, type AuthUsage } from './priorAuthMath';

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/** The usage already counted for a claim (null = none, or released). */
export function countedUsage(submissionData: unknown): AuthUsage | null {
  const u = obj(obj(submissionData).priorAuthUsage);
  if (!u.authId || u.releasedAt) return null;
  return { authId: String(u.authId), authNumber: String(u.authNumber ?? ''), units: Number(u.units) || 0, countedAt: String(u.countedAt ?? '') };
}

/**
 * Count the claim's units against the auth it was sent under. Never throws (a failed count is
 * logged; the claim was already sent). Returns the units counted (0 when nothing to count).
 */
export async function recordPriorAuthUsage(input: {
  organizationId: string;
  claimId: string;
  authNumber: string | null | undefined;
  lines: Array<{ cpt: string; units: number }>;
  actorUserId?: string | null;
}): Promise<number> {
  const authNumber = (input.authNumber || '').trim();
  if (!authNumber) return 0;
  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findFirst({ where: { id: input.claimId, organizationId: input.organizationId }, select: { clientId: true, submissionData: true } });
      if (!claim || countedUsage(claim.submissionData)) return 0;
      const auth = await tx.priorAuth.findFirst({
        where: { organizationId: input.organizationId, clientId: claim.clientId, authNumber, status: 'APPROVED' },
        select: { id: true, cptCodes: true },
      });
      if (!auth) return 0;
      const units = authUnitsForLines(auth.cptCodes, input.lines);
      if (!units) return 0;
      await tx.priorAuth.update({ where: { id: auth.id }, data: { unitsUsed: { increment: units } } });
      const sd = obj(claim.submissionData);
      sd.priorAuthUsage = { authId: auth.id, authNumber, units, countedAt: new Date().toISOString() };
      await tx.claim.update({ where: { id: input.claimId }, data: { submissionData: sd as Prisma.InputJsonValue } });
      await writeAuditLog({
        action: 'prior_auth_units_counted',
        actorUserId: input.actorUserId ?? null,
        organizationId: input.organizationId,
        resourceType: 'PriorAuth',
        resourceId: auth.id,
        patientId: claim.clientId,
        metadata: { claimId: input.claimId, units },
      });
      return units;
    });
  } catch (err) {
    console.error('[prior-auth] usage not counted for claim', input.claimId, err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Give the claim's counted units back (void sent, denied, front-end rejected). Never throws. */
export async function releasePriorAuthUsage(input: { organizationId: string; claimId: string; reason: string; actorUserId?: string | null }): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findFirst({ where: { id: input.claimId, organizationId: input.organizationId }, select: { clientId: true, submissionData: true } });
      const usage = claim ? countedUsage(claim.submissionData) : null;
      if (!claim || !usage) return 0;
      const auth = await tx.priorAuth.findFirst({ where: { id: usage.authId, organizationId: input.organizationId }, select: { id: true, unitsUsed: true } });
      if (auth) {
        await tx.priorAuth.update({ where: { id: auth.id }, data: { unitsUsed: Math.max(0, auth.unitsUsed - usage.units) } });
      }
      const sd = obj(claim.submissionData);
      sd.priorAuthUsage = { ...obj(sd.priorAuthUsage), releasedAt: new Date().toISOString(), releaseReason: input.reason };
      await tx.claim.update({ where: { id: input.claimId }, data: { submissionData: sd as Prisma.InputJsonValue } });
      await writeAuditLog({
        action: 'prior_auth_units_released',
        actorUserId: input.actorUserId ?? null,
        organizationId: input.organizationId,
        resourceType: 'PriorAuth',
        resourceId: usage.authId,
        patientId: claim.clientId,
        metadata: { claimId: input.claimId, units: usage.units, reason: input.reason },
      });
      return usage.units;
    });
  } catch (err) {
    console.error('[prior-auth] usage not released for claim', input.claimId, err instanceof Error ? err.message : err);
    return 0;
  }
}
