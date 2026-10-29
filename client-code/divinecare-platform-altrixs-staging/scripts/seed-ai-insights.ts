/**
 * Seed ClinicModuleState `ai-insights`.
 *
 *   npm run db:seed:ai-insights
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { AI_INSIGHTS_SEED } from "../src/features/ehr/aiInsightsData";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  const orgs = slug
    ? await prisma.organization.findMany({ where: { slug } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });
  if (!orgs.length) throw new Error("No organizations found");

  for (const org of orgs) {
    await prisma.clinicModuleState.upsert({
      where: {
        organizationId_module: {
          organizationId: org.id,
          module: "ai-insights",
        },
      },
      create: {
        organizationId: org.id,
        module: "ai-insights",
        data: AI_INSIGHTS_SEED as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: AI_INSIGHTS_SEED as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(
      `✓ ${org.slug} — ${AI_INSIGHTS_SEED.predictions.length} predictions, ${AI_INSIGHTS_SEED.sentiment.length} sentiment rows`
    );
  }
  console.log(`\nDone — ${orgs.length} org(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
