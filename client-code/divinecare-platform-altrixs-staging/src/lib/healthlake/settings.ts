/** Per-organization HealthLake sync settings (ClinicModuleState module "healthlake-sync"). */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_SYNC_SETTINGS, type SyncSettings } from '@/lib/fhir/mapping/privacy';

export const HEALTHLAKE_SETTINGS_MODULE = 'healthlake-sync';

export type StoredSyncSettings = SyncSettings & {
  updatedAt: string | null;
  updatedById: string | null;
  part2EnabledAt: string | null;
  part2EnabledById: string | null;
};

/** Only literal `true` turns anything on (fail closed). */
export function parseSyncSettings(data: unknown): StoredSyncSettings {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    enabled: d.enabled === true,
    allowPart2Sync: d.allowPart2Sync === true,
    updatedAt: str(d.updatedAt),
    updatedById: str(d.updatedById),
    part2EnabledAt: str(d.part2EnabledAt),
    part2EnabledById: str(d.part2EnabledById),
  };
}

export async function getSyncSettings(db: PrismaClient, organizationId: string): Promise<StoredSyncSettings> {
  const row = await db.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: HEALTHLAKE_SETTINGS_MODULE } },
    select: { data: true },
  });
  return row ? parseSyncSettings(row.data) : { ...DEFAULT_SYNC_SETTINGS, updatedAt: null, updatedById: null, part2EnabledAt: null, part2EnabledById: null };
}

export async function saveSyncSettings(
  db: PrismaClient,
  organizationId: string,
  patch: Partial<SyncSettings>,
  actorUserId: string,
  now = new Date()
): Promise<StoredSyncSettings> {
  const current = await getSyncSettings(db, organizationId);
  const next: StoredSyncSettings = {
    enabled: patch.enabled ?? current.enabled,
    allowPart2Sync: patch.allowPart2Sync ?? current.allowPart2Sync,
    updatedAt: now.toISOString(),
    updatedById: actorUserId,
    part2EnabledAt: current.part2EnabledAt,
    part2EnabledById: current.part2EnabledById,
  };
  if (patch.allowPart2Sync === true && !current.allowPart2Sync) {
    next.part2EnabledAt = now.toISOString();
    next.part2EnabledById = actorUserId;
  }
  if (patch.allowPart2Sync === false) {
    next.part2EnabledAt = null;
    next.part2EnabledById = null;
  }
  await db.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module: HEALTHLAKE_SETTINGS_MODULE } },
    create: { organizationId, module: HEALTHLAKE_SETTINGS_MODULE, data: next },
    update: { data: next },
  });
  return next;
}

export function toSyncSettings(s: StoredSyncSettings): SyncSettings {
  return { enabled: s.enabled, allowPart2Sync: s.allowPart2Sync };
}
