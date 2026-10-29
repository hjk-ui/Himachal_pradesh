/**
 * One-time copy of the legacy Resource Library blobs (ClinicModuleState modules
 * 'resource-uploads' and 'resource-assignments') into resource_items / resource_assignments.
 *
 * Usage:
 *   npx tsx scripts/migrate-resource-library-blob.ts                 dry run, every organization
 *   npx tsx scripts/migrate-resource-library-blob.ts --org <orgId>   dry run, one organization
 *   npx tsx scripts/migrate-resource-library-blob.ts --apply         write
 *
 * Idempotent: rows already copied (legacySourceId) are skipped. The blobs are never changed or
 * deleted. Rules (what is and is not copied; nothing is invented) are in
 * src/lib/resources/blobMigration.ts. Prints counts only (no client names, no titles).
 * Requires DATABASE_URL and migration 20261020_resource_library.sql.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { emptyResourceCounts, planResourceBlobMigration, type ResourceMigrationCounts } from '../src/lib/resources/blobMigration';
import { isSudItem } from '../src/lib/resources/rules';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;

type Counts = ResourceMigrationCounts & { itemsWritten: number; assignmentsWritten: number };

async function migrateOrg(organizationId: string, uploads: unknown, assignments: unknown): Promise<Counts> {
  const [clients, items, existingAssignments] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, select: { id: true } }),
    prisma.resourceItem.findMany({ where: { organizationId, legacySourceId: { not: null } }, select: { id: true, legacySourceId: true } }),
    prisma.resourceAssignment.findMany({ where: { organizationId, legacySourceId: { not: null } }, select: { legacySourceId: true } }),
  ]);
  const plan = planResourceBlobMigration(uploads, assignments, {
    clientIds: new Set(clients.map((c) => c.id)),
    existingItemLegacyIds: new Set(items.map((i) => i.legacySourceId!)),
    existingAssignmentLegacyIds: new Set(existingAssignments.map((a) => a.legacySourceId!)),
  });
  const counts: Counts = { ...plan.counts, itemsWritten: 0, assignmentsWritten: 0 };
  if (!APPLY) return counts;

  const itemIds = new Map(items.map((i) => [i.legacySourceId!, i.id]));
  for (const it of plan.items) {
    try {
      const row = await prisma.resourceItem.create({
        data: {
          organizationId,
          audience: 'patient',
          kind: it.kind,
          title: it.title,
          summary: it.summary,
          topics: it.topics,
          status: it.status,
          sudRelated: isSudItem({ topics: it.topics }),
          publisher: it.placeholder ? null : 'Practice (legacy upload, no file)',
          licenseNote: it.placeholder
            ? 'Legacy placeholder: the old built-in list showed this title with no file or link. Kept only so past assignment history has a name.'
            : 'Legacy upload: the old form saved this title without a file. Upload the real file and complete a clinical review before use.',
          legacySourceId: it.legacySourceId,
        },
      });
      itemIds.set(it.legacySourceId, row.id);
      counts.itemsWritten++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const existing = await prisma.resourceItem.findFirst({ where: { organizationId, legacySourceId: it.legacySourceId }, select: { id: true } });
      if (existing) itemIds.set(it.legacySourceId, existing.id);
    }
  }
  for (const a of plan.assignments) {
    const itemId = itemIds.get(a.itemLegacySourceId);
    if (!itemId) continue;
    try {
      await prisma.resourceAssignment.create({
        data: {
          organizationId,
          itemId,
          clientId: a.clientId,
          assignedById: null,
          assignedByName: null,
          message: a.message,
          dueDate: a.dueDate ? new Date(`${a.dueDate}T00:00:00Z`) : null,
          // Never delivered to the portal by the old page: kept as history, not shown to the client
          status: 'withdrawn',
          sentAt: null,
          withdrawnAt: a.assignedAt ?? new Date(),
          withdrawnReason: 'legacy_not_delivered',
          context: 'legacy',
          part2: false,
          notificationStatus: null,
          legacySourceId: a.legacySourceId,
          ...(a.assignedAt ? { createdAt: a.assignedAt } : {}),
        },
      });
      counts.assignmentsWritten++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  return counts;
}

async function main() {
  const rows = await prisma.clinicModuleState.findMany({
    where: { module: { in: ['resource-uploads', 'resource-assignments'] }, ...(orgArg ? { organizationId: orgArg } : {}) },
    select: { organizationId: true, module: true, data: true },
  });
  const byOrg = new Map<string, { uploads: unknown; assignments: unknown }>();
  for (const r of rows) {
    const cur = byOrg.get(r.organizationId) ?? { uploads: null, assignments: null };
    if (r.module === 'resource-uploads') cur.uploads = r.data;
    else cur.assignments = r.data;
    byOrg.set(r.organizationId, cur);
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${byOrg.size} organization(s) with legacy resource blobs`);
  const total: Counts = { ...emptyResourceCounts(), itemsWritten: 0, assignmentsWritten: 0 };
  for (const [orgId, blobs] of byOrg) {
    const c = await migrateOrg(orgId, blobs.uploads, blobs.assignments);
    console.log(`org ${orgId}:`, JSON.stringify(c));
    for (const k of Object.keys(total) as (keyof Counts)[]) total[k] += c[k];
  }
  console.log('TOTAL:', JSON.stringify(total));
  if (!APPLY) console.log('Nothing written. Re-run with --apply to copy.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
