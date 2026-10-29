-- ============================================================================
-- MIGRATION: 20261019_medical_director.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Medical Director designation (src/lib/auth/medicalDirector.ts)
--   * User."isMedicalDirector": capability flag on a prescriber's staff account
--     (PSYCHIATRIST / NP / PHYSICIAN / MEDICAL_NP). Org-wide patient scope, supervisor
--     co-sign authority and the clinical oversight pages; no Part 2 / VIP bypass.
--     Set only by ADMIN / PRACTICE_DIRECTOR in Admin > Users & Roles > Dashboards
--     (audited STAFF_ACCESS_CHANGE). Existing rows default to false.
--   * User."medicalDirectorScope": optional free-text scope note, e.g. "Primary care"
--     or "Behavioral health" (more than one medical director per org is allowed).
-- Apply BEFORE deploying the code that selects these columns.
-- ============================================================================

ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "isMedicalDirector" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "medicalDirectorScope" TEXT;
