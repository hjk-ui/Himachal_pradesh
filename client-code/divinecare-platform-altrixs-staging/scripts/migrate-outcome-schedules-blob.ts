/**
 * One-time copy of the MBC schedule blob (ClinicModuleState module 'outcome-schedules') into
 * measure_assignments.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/migrate-outcome-schedules-blob.ts                 dry run, every organization
 *   npx tsx --env-file=.env scripts/migrate-outcome-schedules-blob.ts --org <orgId>   dry run, one organization
 *   npx tsx --env-file=.env scripts/migrate-outcome-schedules-blob.ts --apply         write
 *
 * Idempotent: rows already copied (legacySourceId = blob scheduleId) are skipped. The blob is never
 * changed or deleted. Rules (what is and is not copied; nothing is invented) are in
 * src/lib/measures/legacyMigration.ts. Prints counts only (no client names). The old
 * 'outcome-responses' blob held no real scores (the page never received any) and is not copied:
 * scores come from ClinicalAssessmentRecord. Requires migration 20261023_measures_to_patients.sql.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { activeKeyFor } from '../src/lib/measures/schedule';
import { planLegacyScheduleMigration, type LegacyMigrationCounts } from '../src/lib/measures/legacyMigration';
import { clinicDate } from '../src/lib/workflows/dates';
import { writeAuditLog } from '../src/lib/audit/writeAuditLog';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const MODULE = 'outcome-schedules';

async function migrateOrg(organizationId: string, blob: unknown): Promise<LegacyMigrationCounts & { written: number }> {
  const [clients, copied, active] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, select: { id: true } }),
    prisma.measureAssignment.findMany({ where: { organizationId, legacySourceId: { not: null } }, select: { legacySourceId: true } }),
    prisma.measureAssignment.findMany({ where: { organizationId, status: 'active' }, select: { clientId: true, instrumentId: true } }),
  ]);
  const { plan, counts } = planLegacyScheduleMigration(blob, {
    clientIds: new Set(clients.map((c) => c.id)),
    existingLegacyIds: new Set(copied.map((c) => c.legacySourceId!)),
    existingActiveKeys: new Set(active.map((a) => activeKeyFor(a.clientId, a.instrumentId))),
    today: clinicDate(),
  });
  let written = 0;
  if (!APPLY) return { ...counts, written };
  for (const p of plan) {
    try {
      await prisma.measureAssignment.create({
        data: {
          organizationId,
          clientId: p.clientId,
          instrumentId: p.instrumentId,
          schedule: p.schedule,
          everyDays: p.everyDays,
          startDate: new Date(`${p.startDate}T00:00:00Z`),
          source: p.source,
          sourceRef: 'legacy-blob',
          status: p.status,
          activeKey: p.activeKey,
          assignedById: p.assignedById,
          lastSentAt: p.lastSentAt ? new Date(p.lastSentAt) : null,
          legacySourceId: p.legacySourceId,
        },
      });
      written++;
    } catch (e) {
      // Copied by a parallel run, or an open assignment for the same measure appeared meanwhile
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  if (written) {
    await writeAuditLog({
      action: 'MEASURE_ASSIGNMENTS_MIGRATED', actorUserId: null, actorRole: 'SYSTEM', organizationId,
      resourceType: 'measureAssignment', metadata: { source: MODULE, written },
    }).catch(() => undefined);
  }
  return { ...counts, written };
}

async function main() {
  const rows = await prisma.clinicModuleState.findMany({
    where: { module: MODULE, ...(orgArg ? { organizationId: orgArg } : {}) },
    select: { organizationId: true, data: true },
  });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} organization(s) with an outcome-schedules blob`);
  for (const r of rows) {
    const c = await migrateOrg(r.organizationId, r.data);
    console.log(JSON.stringify({ organizationId: r.organizationId, ...c }));
  }
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error('migrate-outcome-schedules-blob failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
