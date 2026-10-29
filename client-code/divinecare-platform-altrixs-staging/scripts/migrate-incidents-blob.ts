/**
 * One-time copy of the legacy incident list (ClinicModuleState module 'incidents', one org-wide JSON
 * list) into IncidentReport rows (migration 20261022_roles_followup_incidents.sql).
 *
 * Usage:
 *   npx tsx scripts/migrate-incidents-blob.ts                 dry run, every organization
 *   npx tsx scripts/migrate-incidents-blob.ts --org <orgId>   dry run, one organization
 *   npx tsx scripts/migrate-incidents-blob.ts --apply         write
 *
 * Idempotent: items already copied (legacySourceId) are skipped. The blob is never changed or
 * deleted. Rules (what is linked, mapped or skipped; nothing is invented) are in
 * src/lib/incidents/blobMigration.ts. Prints counts only (no names, no incident text).
 * Requires DATABASE_URL.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { stripDemoModuleData } from '../src/lib/modules/demoData';
import { emptyIncidentCounts, planIncidentBlobMigration, type IncidentMigrationCounts } from '../src/lib/incidents/blobMigration';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;

type Counts = IncidentMigrationCounts & { written: number };

async function migrateOrg(organizationId: string, blob: unknown): Promise<Counts> {
  const [staff, existing] = await Promise.all([
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.incidentReport.findMany({ where: { organizationId }, select: { incidentNumber: true, legacySourceId: true } }),
  ]);
  // Same records the incidents page showed (explicitly flagged demo rows are not copied)
  const plan = planIncidentBlobMigration(stripDemoModuleData(blob), {
    staff,
    existingLegacyIds: new Set(existing.map((e) => e.legacySourceId).filter((v): v is string => Boolean(v))),
    existingNumbers: new Set(existing.map((e) => e.incidentNumber)),
  });
  const counts: Counts = { ...plan.counts, written: 0 };
  if (!APPLY) return counts;
  for (const row of plan.rows) {
    try {
      await prisma.incidentReport.create({ data: { organizationId, ...row } });
      counts.written++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  return counts;
}

async function main() {
  const rows = await prisma.clinicModuleState.findMany({
    where: { module: 'incidents', ...(orgArg ? { organizationId: orgArg } : {}) },
    select: { organizationId: true, data: true },
  });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} organization(s) with a legacy incident list`);
  const total: Counts = { ...emptyIncidentCounts(), written: 0 };
  for (const r of rows) {
    const c = await migrateOrg(r.organizationId, r.data);
    console.log(`org ${r.organizationId}:`, JSON.stringify(c));
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
