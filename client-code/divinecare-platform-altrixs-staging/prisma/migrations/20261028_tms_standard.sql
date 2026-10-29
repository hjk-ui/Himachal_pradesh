-- ============================================================================
-- MIGRATION: 20261028_tms_standard.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No payer or clinical policy rows are
--         written (the Maryland Medicaid match terms are added by the app to the owner-seeded rule:
--         src/lib/tms/workflowDb.ts ensureOwnerPayerRules).
-- WHY: TMS workflow to industry standard (Oct 28 2026):
--   * the course target is never assumed (it was a built-in 36): "Not set" until a count is
--     authorized or entered;
--   * device picklist + free-text cleared indications / coil, and a practice default device;
--   * a per-payer "minimum failed trials" (blank by default) for the medical-necessity checklist;
--   * score-only course measures: Y-BOCS total (OCD, weekly) and HAM-D / MADRS totals (baseline).
-- CHANGES:
--   * "TmsCourse"."targetSessions"   DROP DEFAULT, DROP NOT NULL. On the FIRST run only (while the
--                                    column is still NOT NULL), courses still at the old default 36
--                                    are set to NULL unless the TMS case confirms 36 (booked or
--                                    authorized count of 36).
--   * tms_case_workflows."deviceDetail"     TEXT
--   * tms_payer_rules."minFailedTrials"     INTEGER (1-20)
--   * "TmsPhq9"."instrument"                TEXT NOT NULL DEFAULT 'phq-9' (existing rows are PHQ-9)
--   * tms_practice_defaults                  one row per organization (device + detail)
-- NOTE: models read without `select`: "TmsCourse" (GET/POST /api/tms/courses, include), "TmsPhq9"
--       (GET /api/tms/phq9), tms_case_workflows (loadWorkflowView findUnique) and tms_payer_rules
--       (loadPayerRules findMany). Those reads fail until this runs (the deploy runs migrations first).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'TmsCourse' AND column_name = 'targetSessions' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "TmsCourse" ALTER COLUMN "targetSessions" DROP DEFAULT;
    ALTER TABLE "TmsCourse" ALTER COLUMN "targetSessions" DROP NOT NULL;
    UPDATE "TmsCourse" c
       SET "targetSessions" = NULL
     WHERE c."targetSessions" = 36
       AND NOT EXISTS (
         SELECT 1 FROM tms_case_workflows w
          WHERE w."courseId" = c."id"
            AND (w."scheduledSessions" = 36 OR w."authorizedSessions" = 36)
       );
  END IF;
END $$;
ALTER TABLE "TmsCourse" ALTER COLUMN "targetSessions" DROP DEFAULT;

ALTER TABLE tms_case_workflows ADD COLUMN IF NOT EXISTS "deviceDetail" TEXT;

ALTER TABLE tms_payer_rules ADD COLUMN IF NOT EXISTS "minFailedTrials" INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tms_payer_rules_min_failed_chk') THEN
    ALTER TABLE tms_payer_rules ADD CONSTRAINT tms_payer_rules_min_failed_chk CHECK ("minFailedTrials" IS NULL OR "minFailedTrials" BETWEEN 1 AND 20);
  END IF;
END $$;

ALTER TABLE "TmsPhq9" ADD COLUMN IF NOT EXISTS "instrument" TEXT NOT NULL DEFAULT 'phq-9';

CREATE TABLE IF NOT EXISTS tms_practice_defaults (
  "organizationId" TEXT PRIMARY KEY,
  "deviceName"     TEXT,
  "deviceDetail"   TEXT,
  "updatedById"    TEXT,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
