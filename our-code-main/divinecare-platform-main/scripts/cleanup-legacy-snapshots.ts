/**
 * scripts/cleanup-legacy-snapshots.ts
 *
 * Cleanup utility strictly for legacy snapshots of:
 * - 'population-health'
 * - 'ai-insights'
 * - 'ehr-overview-kpis'
 *
 * SAFETY GUARANTEES:
 * 1. Dry-run by default: Preview exact IDs, timestamps, and payload summaries.
 * 2. Requires explicit `--apply` flag to execute.
 * 3. Atomic transaction with updatedAt concurrency guards.
 * 4. Privately backs up all targeted rows to backups/ before modification.
 * 5. ONLY touches ClinicModuleState for the 3 target modules.
 *    DOES NOT delete or modify users, organizations, locations, subscriptions,
 *    integration settings, notification rules, templates, or reference data.
 *
 * USAGE:
 *   Dry run preview (no writes):
 *     npx tsx scripts/cleanup-legacy-snapshots.ts
 *     npx tsx scripts/cleanup-legacy-snapshots.ts --org=my-clinic-slug
 *
 *   Execute cleanup:
 *     npx tsx scripts/cleanup-legacy-snapshots.ts --apply
 *     npx tsx scripts/cleanup-legacy-snapshots.ts --org=my-clinic-slug --apply
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, type Prisma } from '@prisma/client';

const TARGET_MODULES = [
  'population-health',
  'ai-insights',
  'ehr-overview-kpis',
] as const;

type TargetModule = (typeof TARGET_MODULES)[number];

const prisma = new PrismaClient();

interface SnapshotSummary {
  id: string;
  organizationId: string;
  orgSlug: string;
  orgName: string;
  module: TargetModule;
  updatedAt: string;
  createdAt: string;
  summary: string;
}

function summarizeData(module: string, data: unknown): string {
  if (!data || typeof data !== 'object') return 'empty or invalid';
  if (Array.isArray(data)) return `${data.length} array items`;

  const obj = data as Record<string, unknown>;
  if (module === 'population-health') {
    const clients = Array.isArray(obj.clients) ? obj.clients.length : 0;
    const actions = Array.isArray(obj.actions) ? obj.actions.length : 0;
    const clinicians = Array.isArray(obj.clinicians) ? obj.clinicians.length : 0;
    const active = typeof obj.activeCaseload === 'number' ? obj.activeCaseload : 'N/A';
    return `activeCaseload=${active}, clients=${clients}, actions=${actions}, clinicians=${clinicians}`;
  }
  if (module === 'ai-insights') {
    const preds = Array.isArray(obj.predictions) ? obj.predictions.length : 0;
    const sent = Array.isArray(obj.sentiment) ? obj.sentiment.length : 0;
    const acc = typeof obj.accuracy === 'number' ? `${obj.accuracy}%` : 'N/A';
    return `accuracy=${acc}, predictions=${preds}, sentiment=${sent}`;
  }
  return `${Object.keys(obj).length} keys`;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const orgArg = args.find((a) => a.startsWith('--org='));
  const orgSlugFilter = orgArg ? orgArg.split('=')[1]?.trim() : undefined;

  console.log('============================================================');
  console.log('   DIVINECARE PLATFORM — LEGACY SNAPSHOT CLEANUP UTILITY    ');
  console.log('============================================================');
  console.log(`Target Modules : ${TARGET_MODULES.join(', ')}`);
  console.log(`Execution Mode : ${isApply ? 'APPLY (LIVE WRITE ENABLED)' : 'DRY RUN (READ-ONLY PREVIEW)'}`);
  if (orgSlugFilter) {
    console.log(`Org Slug Filter: ${orgSlugFilter}`);
  }
  console.log('------------------------------------------------------------\n');

  // Query eligible rows
  const rows = await prisma.clinicModuleState.findMany({
    where: {
      module: { in: [...TARGET_MODULES] },
      ...(orgSlugFilter ? { organization: { slug: orgSlugFilter } } : {}),
    },
    include: {
      organization: {
        select: {
          id: true,
          slug: true,
          name: true,
        },
      },
    },
    orderBy: [{ organizationId: 'asc' }, { module: 'asc' }],
  });

  if (rows.length === 0) {
    console.log('✓ No legacy snapshots found matching target modules.');
    console.log('  Database is already clean. No action required.\n');
    return;
  }

  const summaries: SnapshotSummary[] = rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    orgSlug: r.organization.slug,
    orgName: r.organization.name,
    module: r.module as TargetModule,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    summary: summarizeData(r.module, r.data),
  }));

  console.log(`Found ${rows.length} legacy snapshot row(s) eligible for cleanup:\n`);
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    console.log(`[${i + 1}/${summaries.length}] ID: ${s.id}`);
    console.log(`      Clinic     : ${s.orgName} (${s.orgSlug}) [${s.organizationId}]`);
    console.log(`      Module     : ${s.module}`);
    console.log(`      Created At : ${s.createdAt}`);
    console.log(`      Updated At : ${s.updatedAt}`);
    console.log(`      Payload    : ${s.summary}`);
    console.log('');
  }

  if (!isApply) {
    console.log('============================================================');
    console.log('[DRY RUN COMPLETE] No records were modified or deleted.');
    console.log('To apply cleanup, re-run with --apply:');
    console.log('  npx tsx scripts/cleanup-legacy-snapshots.ts --apply');
    if (orgSlugFilter) {
      console.log(`  npx tsx scripts/cleanup-legacy-snapshots.ts --org=${orgSlugFilter} --apply`);
    }
    console.log('============================================================\n');
    return;
  }

  // APPLY MODE: Private backup first
  console.log('--- EXECUTING CLEANUP (APPLY MODE) ---');
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `legacy-snapshots-${timestamp}.backup.json`;
  const backupFilePath = path.join(backupDir, backupFileName);

  const backupData = rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    orgSlug: r.organization.slug,
    module: r.module,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    data: r.data,
  }));

  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf-8');
  console.log(`✓ Step 1: Privately backed up ${rows.length} row(s) to:`);
  console.log(`  ${backupFilePath}\n`);

  // Step 2: Atomic transaction with updatedAt guard
  console.log('✓ Step 2: Deleting snapshots under atomic transaction with concurrency guards...');
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      const res = await tx.clinicModuleState.deleteMany({
        where: {
          id: r.id,
          organizationId: r.organizationId,
          module: r.module,
          updatedAt: r.updatedAt, // Concurrency guard: abort if modified since preview
        },
      });

      if (res.count !== 1) {
        throw new Error(
          `Concurrency guard violation: Snapshot ${r.id} (${r.module}) was modified concurrently. Aborting transaction.`
        );
      }
    }
  });

  console.log(`\n✓ SUCCESS: Successfully cleaned up ${rows.length} legacy snapshot(s).`);
  console.log('  All target modules now resolve cleanly to runtime empty defaults.\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Cleanup utility failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
