import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  READ_ONLY_MESSAGE,
  compedOrgIds,
  featureDeniedMessage,
  hasFeature,
  resolveAccess,
  type OrgAccess,
} from './entitlements';
import { type FeatureId } from './plans';
import { countSeats, type SeatCount } from './seats';
import {
  SUBSCRIPTION_MODULE,
  normalizeRecord,
  type OrgSubscriptionRecord,
} from './subscriptionRecord';

export async function loadSubscriptionRecord(
  organizationId: string
): Promise<{ record: OrgSubscriptionRecord; rowId: string | null; rowUpdatedAt: Date | null }> {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: SUBSCRIPTION_MODULE } },
    select: { id: true, data: true, updatedAt: true },
  });
  return {
    record: normalizeRecord(row?.data ?? null),
    rowId: row?.id ?? null,
    rowUpdatedAt: row?.updatedAt ?? null,
  };
}

export async function saveSubscriptionRecord(organizationId: string, record: OrgSubscriptionRecord) {
  const data = record as unknown as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module: SUBSCRIPTION_MODULE } },
    create: { organizationId, module: SUBSCRIPTION_MODULE, data },
    update: { data },
  });
}

/**
 * Read-modify-write with optimistic concurrency on the row's updatedAt, so two webhook
 * deliveries for the same org cannot overwrite each other. `fn` returns null to skip saving.
 */
export async function updateSubscriptionRecord(
  organizationId: string,
  fn: (current: OrgSubscriptionRecord) => OrgSubscriptionRecord | null
): Promise<OrgSubscriptionRecord> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { record, rowId, rowUpdatedAt } = await loadSubscriptionRecord(organizationId);
    const next = fn(record);
    if (!next) return record;
    const data = next as unknown as Prisma.InputJsonValue;
    if (!rowId || !rowUpdatedAt) {
      try {
        await prisma.clinicModuleState.create({
          data: { organizationId, module: SUBSCRIPTION_MODULE, data },
        });
        return next;
      } catch {
        continue; // someone created it concurrently; retry against the stored row
      }
    }
    const res = await prisma.clinicModuleState.updateMany({
      where: { id: rowId, updatedAt: rowUpdatedAt },
      data: { data },
    });
    if (res.count === 1) return next;
  }
  throw new Error('Subscription record changed concurrently; retry later');
}

export async function getOrgAccess(organizationId: string, now: Date = new Date()): Promise<OrgAccess> {
  const { record } = await loadSubscriptionRecord(organizationId);
  return resolveAccess(organizationId, record, { now, comped: compedOrgIds() });
}

export type GateResult =
  | { ok: true; access: OrgAccess }
  | { ok: false; status: 402; error: string; code: 'feature_not_in_plan' | 'read_only'; access: OrgAccess };

/** Use in API routes before a feature-specific action. */
export async function requireFeature(organizationId: string, feature: FeatureId): Promise<GateResult> {
  const access = await getOrgAccess(organizationId);
  if (!hasFeature(access, feature)) {
    return { ok: false, status: 402, error: featureDeniedMessage(access, feature), code: 'feature_not_in_plan', access };
  }
  return { ok: true, access };
}

/** Use in API routes that create or change records. Comped / grandfathered always pass. */
export async function requireWritable(organizationId: string): Promise<GateResult> {
  const access = await getOrgAccess(organizationId);
  if (!access.canWrite) {
    return { ok: false, status: 402, error: READ_ONLY_MESSAGE, code: 'read_only', access };
  }
  return { ok: true, access };
}

/** Feature + write in one call (for write actions on gated features). */
export async function requireFeatureWrite(organizationId: string, feature: FeatureId): Promise<GateResult> {
  const gate = await requireFeature(organizationId, feature);
  if (!gate.ok) return gate;
  if (!gate.access.canWrite) {
    return { ok: false, status: 402, error: READ_ONLY_MESSAGE, code: 'read_only', access: gate.access };
  }
  return gate;
}

/** Active users by seat type (prescriber / clinician / paraprofessional / free support). */
export async function countOrgSeats(organizationId: string): Promise<SeatCount> {
  const users = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: { role: true, roles: true, status: true },
  });
  return countSeats(users);
}

/** Active locations (sites) — drives the additional-location add-on and per-site onboarding. */
export async function countOrgLocations(organizationId: string): Promise<number> {
  return prisma.location.count({ where: { organizationId, active: true } });
}
