import { prisma } from '../src/lib/db/prisma';

async function main() {
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrisisTeamPage_episodeId_idx" ON "CrisisTeamPage"("episodeId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrisisTeamPage_trigger_idx" ON "CrisisTeamPage"("trigger");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrisisTeamPage_pagedAt_idx" ON "CrisisTeamPage"("pagedAt");`);
  console.log('✔ All CrisisTeamPage indexes created successfully');
}

main()
  .catch((err) => {
    console.error('Index creation error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
