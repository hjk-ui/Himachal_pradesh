/**
 * Manual purge for IntegrationCallLog + optional DrFirst API logs retention.
 * Usage: npx tsx scripts/integration-logs-purge.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const metaDays = Number(process.env.INTEGRATION_LOG_METADATA_RETENTION_DAYS || 365);
  const drfirstDays = Number(process.env.DRFIRST_LOG_RETENTION_DAYS || 90);
  const metaCutoff = new Date(Date.now() - metaDays * 24 * 60 * 60_000);
  const dfCutoff = new Date(Date.now() - drfirstDays * 24 * 60 * 60_000);

  const meta = await prisma.integrationCallLog.deleteMany({
    where: { createdAt: { lt: metaCutoff } },
  });
  console.log(`Purged ${meta.count} IntegrationCallLog rows older than ${metaDays}d`);

  try {
    const df = await (prisma as { drfirstApiLog?: { deleteMany: Function } }).drfirstApiLog?.deleteMany?.({
      where: { createdAt: { lt: dfCutoff } },
    });
    if (df) console.log(`Purged ${df.count} drfirst_api_logs older than ${drfirstDays}d`);
  } catch {
    console.log('drfirst_api_logs table not present — skipped');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
