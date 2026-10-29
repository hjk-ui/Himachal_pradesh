import { prisma } from '../src/lib/db/prisma';

async function main() {
  console.log('=== Adding MEDICAL_ASSISTANT and CRISIS_RESPONDER to DB Role enum ===');
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MEDICAL_ASSISTANT';`);
    console.log('✔ Enum value MEDICAL_ASSISTANT added/confirmed');
  } catch (err: any) {
    console.log('Notice (MEDICAL_ASSISTANT):', err.message);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CRISIS_RESPONDER';`);
    console.log('✔ Enum value CRISIS_RESPONDER added/confirmed');
  } catch (err: any) {
    console.log('Notice (CRISIS_RESPONDER):', err.message);
  }

  console.log('=== Ensuring CrisisTeamPage table exists in DB ===');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CrisisTeamPage" (
      "id" TEXT NOT NULL,
      "organizationId" TEXT,
      "episodeId" TEXT,
      "episodeNumber" TEXT,
      "pagedBy" TEXT DEFAULT 'on_call_dispatcher',
      "trigger" TEXT NOT NULL,
      "assignedTeam" TEXT NOT NULL,
      "smsDelivered" BOOLEAN NOT NULL DEFAULT true,
      "pushDelivered" BOOLEAN NOT NULL DEFAULT true,
      "snsDelivered" BOOLEAN NOT NULL DEFAULT true,
      "respondersAck" INTEGER NOT NULL DEFAULT 2,
      "respondersTotal" INTEGER NOT NULL DEFAULT 2,
      "supervisorNotified" BOOLEAN NOT NULL DEFAULT true,
      "deliveryStatus" TEXT NOT NULL DEFAULT 'acknowledged',
      "pagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "secureEpisodeLink" TEXT,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CrisisTeamPage_pkey" PRIMARY KEY ("id")
    );
  `);
  console.log('✔ CrisisTeamPage table confirmed in PostgreSQL');

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CrisisTeamPage_episodeId_idx" ON "CrisisTeamPage"("episodeId");
    CREATE INDEX IF NOT EXISTS "CrisisTeamPage_trigger_idx" ON "CrisisTeamPage"("trigger");
    CREATE INDEX IF NOT EXISTS "CrisisTeamPage_pagedAt_idx" ON "CrisisTeamPage"("pagedAt");
  `);
  console.log('✔ CrisisTeamPage indexes confirmed');
}

main()
  .catch((err) => {
    console.error('Migration error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
