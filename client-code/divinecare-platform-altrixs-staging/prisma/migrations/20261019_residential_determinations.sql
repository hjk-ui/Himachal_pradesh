-- ============================================================================
-- MIGRATION: 20261019_residential_determinations.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Residential > Admissions "Determination Log" (src/app/api/residential/determinations)
--   * ResidentialDetermination: one row per screening outcome (admitted / waitlisted / referred),
--     scoped by organizationId. Replaces the page's in-memory list, which was lost on reload.
--   * NO BACKFILL: earlier determinations were never stored.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ResidentialDetermination" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "applicantName"  TEXT NOT NULL,
  "clientId"       TEXT,
  "outcome"        TEXT NOT NULL,
  "level"          TEXT,
  "detail"         TEXT NOT NULL,
  "residentId"     TEXT,
  "createdById"    TEXT,
  "determinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResidentialDetermination_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ResidentialDetermination_organizationId_determinedAt_idx"
  ON "ResidentialDetermination" ("organizationId", "determinedAt");
