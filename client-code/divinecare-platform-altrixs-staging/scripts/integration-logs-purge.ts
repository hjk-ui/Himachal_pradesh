/**
 * Integration log retention (NOT installed as a cron yet; run by hand or add to the server crontab
 * once approved):
 *   npx tsx --env-file=.env scripts/integration-logs-purge.ts [--dry-run]
 *
 *  - integration_call_logs: metadata rows older than INTEGRATION_LOG_METADATA_RETENTION_DAYS (365).
 *  - drfirst_api_logs: DrFirst request / response bodies (encrypted) older than
 *    DRFIRST_LOG_RETENTION_DAYS (90). The unified metadata row stays for the year; its detail then
 *    says the body is no longer stored.
 * Prints counts only.
 */
import { prisma } from '@/lib/db/prisma';
import { purgeRcopiaLogs } from '@/lib/drfirst/persistence';
import { retentionCutoffs } from '@/lib/integrations/callLog/view';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const c = retentionCutoffs(new Date());
  if (dryRun) {
    const [meta, payloads] = await Promise.all([
      prisma.integrationCallLog.count({ where: { createdAt: { lt: c.metadataBefore } } }),
      prisma.drFirstApiLog.count({ where: { createdAt: { lt: c.payloadBefore } } }),
    ]);
    console.log(`dry run: would delete ${meta} integration log rows (> ${c.metadataDays} d) and ${payloads} DrFirst payload rows (> ${c.payloadDays} d)`);
    return;
  }
  const meta = await prisma.integrationCallLog.deleteMany({ where: { createdAt: { lt: c.metadataBefore } } });
  const payloads = await purgeRcopiaLogs();
  console.log(`${new Date().toISOString()} integration-logs-purge: deleted ${meta.count} log rows, ${payloads} DrFirst payload rows`);
}

main()
  .catch((err) => {
    console.error('integration-logs-purge failed:', err instanceof Error ? err.name : 'unknown');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
