-- ============================================================================
-- MIGRATION: 20261022_prp_standard.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: PRP review against the Maryland standard (COMAR 10.63 PRP, Maryland Medicaid PBHS via Carelon).
--   * PracticeSettings: PRP billing model confirmed by the practice (null = not confirmed),
--     who confirmed it and when; practice-policy monthly contact minimum (null = not set).
--     The IRP review interval reuses the existing column "prpIrpReviewDays".
--   * PrpReferral: referring licensed mental health professional's credential, license state and
--     treating relationship (name / NPI / license number columns already exist).
--   * PrpEnrollment: discharge type, transition plan, aftercare plan, discharged by.
--   * prp_attendance: per-encounter documentation (onsite / offsite, IRP goal addressed,
--     intervention, participant response).
-- See src/lib/prp/standard.ts.
-- ============================================================================

ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "prpBillingModel" TEXT;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "prpBillingModelConfirmedBy" TEXT;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "prpBillingModelConfirmedAt" TIMESTAMP(3);
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "prpMonthlyMinContacts" INTEGER;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "prpPolicyUpdatedBy" TEXT;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "prpPolicyUpdatedAt" TIMESTAMP(3);

ALTER TABLE "PrpReferral" ADD COLUMN IF NOT EXISTS "referrerCredential" TEXT;
ALTER TABLE "PrpReferral" ADD COLUMN IF NOT EXISTS "referrerLicenseState" TEXT;
ALTER TABLE "PrpReferral" ADD COLUMN IF NOT EXISTS "referrerIsTreating" BOOLEAN;

ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "dischargeType" TEXT;
ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "transitionPlan" TEXT;
ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "aftercarePlan" TEXT;
ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "dischargedById" TEXT;

ALTER TABLE "prp_attendance" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "prp_attendance" ADD COLUMN IF NOT EXISTS "irpGoal" TEXT;
ALTER TABLE "prp_attendance" ADD COLUMN IF NOT EXISTS "intervention" TEXT;
ALTER TABLE "prp_attendance" ADD COLUMN IF NOT EXISTS "response" TEXT;
