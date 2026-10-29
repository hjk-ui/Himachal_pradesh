-- ============================================================================
-- MIGRATION: 20261022_owner_decisions_eligibility_nightly.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: owner decisions of 2026-10-21.
--   * Practice setting "Automatic overnight eligibility checks" (scripts/eligibility-nightly.ts):
--     default OFF, to be turned on after Waystar production is live.
--   * "Allow on test clearinghouse": default OFF; the nightly job refuses to send while the Waystar
--     usage indicator is T (test) unless this is on.
-- The MA standing-order draft list (primary care) lives in the existing JSON column
-- primary_care_settings.poc_standing_orders and needs no DDL. See src/lib/eligibility/nightly.ts.
-- ============================================================================

ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "eligibilityNightlyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "eligibilityNightlyAllowTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "eligibilityNightlyUpdatedBy" TEXT;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "eligibilityNightlyUpdatedAt" TIMESTAMP(3);
