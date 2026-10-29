import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { PracticeSettingsError, type PracticeActor } from '@/lib/practice/store';
import { capacityInputSchema, isAsamLevel, type CapacityRow } from './capacity';

/**
 * Residential capacity persistence (residential_capacity). Org scoped; writes are audited with
 * location / level / bed counts only (no PHI). A missing table (migration not run yet) reads as
 * "not configured" with migrationPending = true.
 */

export type CapacityRowView = CapacityRow & { id: string; note: string | null; updatedAt: string };

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || /residential_capacity.*does not exist|relation .*residential_capacity/i.test(msg);
}

export async function loadResidentialCapacity(organizationId: string): Promise<{ rows: CapacityRowView[]; migrationPending: boolean }> {
  try {
    const rows = await prisma.residentialCapacity.findMany({
      where: { organizationId },
      orderBy: [{ locationId: 'asc' }, { asamLevel: 'asc' }],
    });
    return {
      rows: rows
        .filter((r) => isAsamLevel(r.asamLevel))
        .map((r) => ({ id: r.id, locationId: r.locationId, asamLevel: r.asamLevel, beds: r.beds, rooms: r.rooms, note: r.note, updatedAt: r.updatedAt.toISOString() })),
      migrationPending: false,
    };
  } catch (err) {
    if (isMissingTable(err)) return { rows: [], migrationPending: true };
    throw err;
  }
}

/** Upserts each entry; beds = null deletes that level. Locations must belong to the organization. */
export async function saveResidentialCapacity(actor: PracticeActor, raw: unknown) {
  const { entries } = capacityInputSchema.parse(raw);
  const locIds = [...new Set(entries.map((e) => e.locationId))];
  const owned = new Set(
    (await prisma.location.findMany({ where: { organizationId: actor.organizationId, id: { in: locIds } }, select: { id: true } })).map((l) => l.id)
  );
  const foreign = locIds.filter((id) => !owned.has(id));
  if (foreign.length) throw new PracticeSettingsError('Location not found', 404);

  const changes: { locationId: string; asamLevel: string; beds: number | null; rooms: number }[] = [];
  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      const key = { organizationId_locationId_asamLevel: { organizationId: actor.organizationId, locationId: e.locationId, asamLevel: e.asamLevel } };
      if (e.beds === null) {
        const del = await tx.residentialCapacity.deleteMany({ where: { organizationId: actor.organizationId, locationId: e.locationId, asamLevel: e.asamLevel } });
        if (del.count) changes.push({ locationId: e.locationId, asamLevel: e.asamLevel, beds: null, rooms: 0 });
        continue;
      }
      const data = { beds: e.beds, rooms: e.rooms, note: e.note, updatedById: actor.userId };
      const before = await tx.residentialCapacity.findUnique({ where: key });
      if (before && before.beds === e.beds && before.rooms.join('\u0000') === e.rooms.join('\u0000') && (before.note ?? null) === e.note) continue;
      await tx.residentialCapacity.upsert({
        where: key,
        create: { organizationId: actor.organizationId, locationId: e.locationId, asamLevel: e.asamLevel, ...data },
        update: data,
      });
      changes.push({ locationId: e.locationId, asamLevel: e.asamLevel, beds: e.beds, rooms: e.rooms.length });
    }
  });

  await writeAuditLog({
    action: 'residential_capacity_updated',
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId: actor.organizationId,
    resourceType: 'ResidentialCapacity',
    resourceId: actor.organizationId,
    metadata: { changes, changedCount: changes.length },
  });
  return { changes, ...(await loadResidentialCapacity(actor.organizationId)) };
}
