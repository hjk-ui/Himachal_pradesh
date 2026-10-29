-- ============================================================================
-- MIGRATION: 20261019_report_library.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Report library (src/lib/reports/library)
--   * report_saved_views: a user's saved report parameters and optional scheduled delivery.
--     Stores report id + parameters only (dates / preset, site / provider ids, payer text, select
--     values); never results or patient data. A schedule emails the owner a sign-in link (no PHI).
--   * Indexes for the period reports: claims / denials / ERA adjustments by organization + date,
--     audit log by organization + action + date (sign-in / activity reports), break-the-glass by
--     organization + date, notes by date of service, primary care visits by visit date.
-- Apply BEFORE deploying the code that reads report_saved_views. The indexes are plain
-- CREATE INDEX IF NOT EXISTS (short write lock on each table; run off-hours on production).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "report_saved_views" (
  "id"               TEXT NOT NULL,
  "organization_id"  TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "report_id"        VARCHAR(80) NOT NULL,
  "name"             VARCHAR(120) NOT NULL,
  "params"           JSONB NOT NULL DEFAULT '{}',
  -- none | daily | weekly | monthly
  "schedule"         VARCHAR(10) NOT NULL DEFAULT 'none',
  -- hour of day on the practice clock (0-23)
  "schedule_hour"    INTEGER NOT NULL DEFAULT 7,
  -- 0 = Sunday ... 6 = Saturday (weekly only)
  "schedule_weekday" INTEGER,
  "next_run_at"      TIMESTAMPTZ(6),
  "last_sent_at"     TIMESTAMPTZ(6),
  "last_error"       VARCHAR(200),
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "report_saved_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_saved_views_organization_id_user_id_idx"
  ON "report_saved_views" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "report_saved_views_schedule_next_run_at_idx"
  ON "report_saved_views" ("schedule", "next_run_at");

-- Period report indexes (names match prisma/schema.prisma @@index defaults)
CREATE INDEX IF NOT EXISTS "Claim_organizationId_createdAt_idx" ON "Claim" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ClaimDenial_organizationId_createdAt_idx" ON "ClaimDenial" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog" ("organizationId", "action", "createdAt");
CREATE INDEX IF NOT EXISTS "BreakTheGlassGrant_organizationId_grantedAt_idx" ON "BreakTheGlassGrant" ("organizationId", "grantedAt");
CREATE INDEX IF NOT EXISTS "ProgressNote_dateOfService_idx" ON "ProgressNote" ("dateOfService");
CREATE INDEX IF NOT EXISTS "MedicalVisit_visitDate_idx" ON "MedicalVisit" ("visitDate");

-- era_adjustments arrives with an earlier Waystar migration; skip quietly where it does not exist yet
DO $$
BEGIN
  IF to_regclass('public.era_adjustments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "era_adjustments_organization_id_created_at_idx"
      ON "era_adjustments" ("organization_id", "created_at");
  END IF;
END $$;
