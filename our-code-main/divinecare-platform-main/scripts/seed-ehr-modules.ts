/**
 * Seed ClinicModuleState for EHR / Quality / Population / SDOH / Peer / HR training pages.
 * Upserts into every organization (or SEED_ORG_SLUG if set).
 *
 *   npm run db:seed:ehr-modules
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { SAFETY_PLAN_SEED } from "../src/features/ehr/safetyPlansData";
import { DISCHARGE_CASES_SEED } from "../src/features/ehr/dischargeData";
import { INCIDENTS_SEED } from "../src/features/compliance/incidentsData";
import {
  COMPLIANCE_CALENDAR_SEED,
  COMPLIANCE_META_SEED,
} from "../src/features/compliance/complianceCalendarData";
import {
  GRIEVANCES_META_SEED,
  GRIEVANCES_SEED,
} from "../src/features/compliance/grievancesData";
import {
  QI_CAPS_SEED,
  QI_INDICATORS_SEED,
  QI_MEETINGS_SEED,
  QI_META_SEED,
} from "../src/features/analytics/qiData";
import {
  POPULATION_ACTIONS_SEED,
  POPULATION_CLIENTS_SEED,
  POPULATION_HEALTH_SEED,
} from "../src/features/analytics/populationHealthData";
import {
  SDOH_RESOURCES_SEED,
  SDOH_SCREENINGS_SEED,
} from "../src/features/analytics/sdohData";
import {
  PEER_CONTACTS_SEED,
  PEER_GOALS_SEED,
  PEER_META_SEED,
  PEER_PLACEMENTS_SEED,
} from "../src/features/compliance/peerSupportData";
import {
  HR_TRAININGS_CATALOG_SEED,
  HR_TRAINING_STAFF_SEED,
} from "../src/features/hr/trainingData";
import {
  EHR_OVERVIEW_KPI_SEED,
  EHR_PENDING_ACTIONS_SEED,
  EHR_RECENT_NOTES_SEED,
  EHR_REVAL_SEED,
} from "../src/features/ehr/overviewData";
import { ASSESSMENTS_SEED } from "../src/features/ehr/assessments/catalog";
import {
  PRESCRIPTIONS_SEED,
  REFILL_REQUESTS_SEED,
} from "../src/features/ehr/prescriptionSeedData";
import { AI_INSIGHTS_SEED } from "../src/features/ehr/aiInsightsData";
import {
  PRP_DOMAINS_SEED,
  PRP_GROUPS_SEED,
  PRP_META_SEED,
  PRP_PARTICIPANTS_SEED,
  PRP_REPORTS_SEED,
} from "../src/features/programs/prpProgramData";
import { SUBSCRIPTION_PAGE_SEED } from "../src/lib/subscription/catalog";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "";

const MODULES: { module: string; data: unknown }[] = [
  { module: "ehr-overview-kpis", data: EHR_OVERVIEW_KPI_SEED },
  { module: "ehr-overview-revals", data: EHR_REVAL_SEED },
  { module: "ehr-overview-recent-notes", data: EHR_RECENT_NOTES_SEED },
  { module: "ehr-overview-pending-actions", data: EHR_PENDING_ACTIONS_SEED },
  { module: "assessments", data: ASSESSMENTS_SEED },
  { module: "prescriptions", data: PRESCRIPTIONS_SEED },
  { module: "prescription-refills", data: REFILL_REQUESTS_SEED },
  { module: "ehr-safety-plans", data: SAFETY_PLAN_SEED },
  { module: "ehr-discharge-cases", data: DISCHARGE_CASES_SEED },
  { module: "incidents", data: INCIDENTS_SEED },
  { module: "compliance-calendar", data: COMPLIANCE_CALENDAR_SEED },
  { module: "compliance-meta", data: [COMPLIANCE_META_SEED] },
  { module: "grievances", data: GRIEVANCES_SEED },
  { module: "grievances-meta", data: [GRIEVANCES_META_SEED] },
  { module: "qi-indicators", data: QI_INDICATORS_SEED },
  { module: "qi-caps", data: QI_CAPS_SEED },
  { module: "qi-meetings", data: QI_MEETINGS_SEED },
  { module: "qi-meta", data: [QI_META_SEED] },
  { module: "population-clients", data: POPULATION_CLIENTS_SEED },
  { module: "population-actions", data: POPULATION_ACTIONS_SEED },
  { module: "population-health", data: POPULATION_HEALTH_SEED },
  { module: "sdoh-screenings", data: SDOH_SCREENINGS_SEED },
  { module: "sdoh-resources", data: SDOH_RESOURCES_SEED },
  { module: "peer-contacts", data: PEER_CONTACTS_SEED },
  { module: "peer-goals", data: PEER_GOALS_SEED },
  { module: "peer-placements", data: PEER_PLACEMENTS_SEED },
  { module: "peer-meta", data: [PEER_META_SEED] },
  { module: "hr-training-staff", data: HR_TRAINING_STAFF_SEED },
  { module: "hr-trainings-catalog", data: HR_TRAININGS_CATALOG_SEED },
  { module: "ai-insights", data: AI_INSIGHTS_SEED },
  { module: "prp-meta", data: [PRP_META_SEED] },
  { module: "prp-groups", data: PRP_GROUPS_SEED },
  { module: "prp-participants", data: PRP_PARTICIPANTS_SEED },
  { module: "prp-domains", data: PRP_DOMAINS_SEED },
  { module: "prp-reports", data: PRP_REPORTS_SEED },
  { module: "subscription-page", data: [SUBSCRIPTION_PAGE_SEED] },
];

async function main() {
  const orgs = ORG_SLUG
    ? await prisma.organization.findMany({ where: { slug: ORG_SLUG } })
    : await prisma.organization.findMany({ orderBy: { slug: "asc" } });

  if (!orgs.length) {
    throw new Error(
      ORG_SLUG
        ? `No organization with slug "${ORG_SLUG}"`
        : "No organizations found — create a clinic first"
    );
  }

  for (const org of orgs) {
    console.log(`\n→ ${org.name} (${org.slug})`);
    for (const { module, data } of MODULES) {
      const payload = data as Prisma.InputJsonValue;
      await prisma.clinicModuleState.upsert({
        where: {
          organizationId_module: { organizationId: org.id, module },
        },
        create: { organizationId: org.id, module, data: payload },
        update: { data: payload },
      });
      const count = Array.isArray(data) ? data.length : 1;
      console.log(`  ✓ ${module} (${count} rows)`);
    }
  }

  console.log(`\nDone — seeded ${MODULES.length} modules × ${orgs.length} org(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
