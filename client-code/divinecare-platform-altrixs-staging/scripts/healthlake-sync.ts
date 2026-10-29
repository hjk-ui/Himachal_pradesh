/**
 * Scheduled HealthLake FHIR R4 sync, run on the server by cron (not over HTTP):
 *   npx tsx --conditions=react-server --env-file=.env scripts/healthlake-sync.ts
 * For every active organization (or DEFAULT_ORG) that turned sync on: scan rows -> FHIR,
 * update the FhirSyncState outbox, PUT / DELETE due rows with retry + backoff, and refresh
 * open import/export jobs. Prints ids and counts only. No-op when HealthLake is not configured.
 */
import { prisma } from '@/lib/db/prisma';
import { withIntegrationCall } from '@/lib/integrations/callLog/record';
import { refreshJobs } from '@/lib/healthlake/bulk';
import { createHealthLakeTransport } from '@/lib/healthlake/client';
import { HEALTHLAKE_NOT_CONFIGURED_MESSAGE, healthLakeConfig } from '@/lib/healthlake/config';
import { runOrgSync } from '@/lib/healthlake/sync';

async function main() {
  const cfg = healthLakeConfig();
  const transport = createHealthLakeTransport(cfg);
  if (!transport) {
    console.log(`${HEALTHLAKE_NOT_CONFIGURED_MESSAGE}; nothing was synced. Missing: ${cfg.missing.join(', ')}`);
    return;
  }
  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({
    where: only ? { id: only } : { active: true },
    select: { id: true },
  });
  for (const org of orgs) {
    try {
      await refreshJobs(prisma, org.id, transport);
    } catch (err) {
      console.error(`${new Date().toISOString()} org=${org.id} job refresh failed:`, err instanceof Error ? err.message : err);
    }
    const s = await runOrgSync({ db: prisma, organizationId: org.id, transport, trigger: 'cron' });
    if (s.status === 'SKIPPED') {
      console.log(`${new Date().toISOString()} org=${org.id} skipped (${s.reason})`);
      continue;
    }
    console.log(
      `${new Date().toISOString()} org=${org.id} ${s.status} scanned=${s.scanned} queued=${s.queued} synced=${s.synced} deleted=${s.deleted} failed=${s.failed} dead=${s.dead} excluded=${s.excluded}${s.error ? ` | ${s.error}` : ''}`
    );
  }
}

withIntegrationCall({ integration: 'cron', operation: 'healthlake-sync', direction: 'job' }, main)
  .catch((err) => {
    console.error(`${new Date().toISOString()} healthlake-sync error:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
