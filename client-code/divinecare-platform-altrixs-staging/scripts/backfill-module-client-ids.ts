/**
 * Link legacy per-client module items (ClinicModuleState lists saved with a client NAME only) to the
 * client record by exact, unique name match, so the caseload scope on /api/modules/[module]
 * (src/lib/modules/clientScope.ts) shows them to the client's treating clinicians. Unlinked items
 * stay visible to org-wide roles only.
 *
 * Usage:
 *   npx tsx scripts/backfill-module-client-ids.ts                         dry run, every organization
 *   npx tsx scripts/backfill-module-client-ids.ts --org <orgId>           dry run, one organization
 *   npx tsx scripts/backfill-module-client-ids.ts --module ehr-safety-plans
 *   npx tsx scripts/backfill-module-client-ids.ts --apply                 write
 *
 * Idempotent: linked items are skipped. Only `clientId` is added; zero or several name matches are
 * left unlinked (never guessed). Writes are conditional on the row's updatedAt (a concurrent page
 * save wins; re-run). Prints counts only (no names). Requires DATABASE_URL.
 */
import { prisma } from '../src/lib/db/prisma';
import { clientOrgFilter } from '../src/lib/clients/orgScope';
import {
  NAME_LINK_MODULES,
  clientNameIndex,
  emptyClientLinkCounts,
  planModuleClientLinks,
  type ClientLinkCounts,
} from '../src/lib/modules/clientLinkBackfill';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;
const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : null;

async function main() {
  const modules = moduleArg ? [moduleArg] : Object.keys(NAME_LINK_MODULES);
  if (moduleArg && !NAME_LINK_MODULES[moduleArg]) throw new Error(`Unsupported module: ${moduleArg}`);
  const rows = await prisma.clinicModuleState.findMany({
    where: { module: { in: modules }, ...(orgArg ? { organizationId: orgArg } : {}) },
    select: { id: true, organizationId: true, module: true, data: true, updatedAt: true },
  });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} module list(s)`);
  const total: ClientLinkCounts & { listsWritten: number; conflicts: number } = { ...emptyClientLinkCounts(), listsWritten: 0, conflicts: 0 };
  const indexByOrg = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    let index = indexByOrg.get(row.organizationId);
    if (!index) {
      const clients = await prisma.client.findMany({ where: clientOrgFilter(row.organizationId), select: { id: true, name: true } });
      index = clientNameIndex(clients);
      indexByOrg.set(row.organizationId, index);
    }
    const plan = planModuleClientLinks(row.module, row.data, index);
    console.log(`org ${row.organizationId} ${row.module}:`, JSON.stringify(plan.counts));
    for (const k of Object.keys(plan.counts) as (keyof ClientLinkCounts)[]) total[k] += plan.counts[k];
    if (APPLY && plan.changed) {
      const res = await prisma.clinicModuleState.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: { data: plan.data as never },
      });
      if (res.count === 1) total.listsWritten++;
      else total.conflicts++;
    }
  }
  console.log('TOTAL:', JSON.stringify(total));
  if (!APPLY) console.log('Nothing written. Re-run with --apply to link.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
