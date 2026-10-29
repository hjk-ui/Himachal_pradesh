-- ============================================================================
-- MIGRATION: 20261018_client_primary_care.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: primary care inside the one client record (src/lib/medical/medicalProgram.ts)
--   * Client."primaryCare": set true by the primary-care intake route only. A client is a
--     primary-care patient when this is true, OR it has MedicalVisit / MedicalVital /
--     MedicalCharge rows, OR imported Valant journal rows with facility 'Family Practice'.
--     Existing rows default to false (no backfill: the other two signals cover them).
--   * MedicalProblem."icd10Code" nullable: intake problems are stored uncoded ("needs coding")
--     until a provider sets the code; no ICD-10 code is guessed.
-- ============================================================================

ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "primaryCare" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS "MedicalProblem" ALTER COLUMN "icd10Code" DROP NOT NULL;
