-- ============================================================================
-- MIGRATION: 20261025_identifying_info.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: "Identifying Information" section of the intake / evaluation / re-evaluation notes
--   (src/lib/ehr/identifyingInfo.ts). Every other identifying field already exists on "Client"
--   (20261019_client_demographics_standard.sql: sexAtBirth, genderIdentity, pronouns, race,
--   ethnicity, maritalStatus, preferredLanguage, interpreterNeeded, guardian*, hasGuardian).
--   * namePrefix: the title the client uses (Mr. / Ms. / Mrs. / Mx. / Dr.). Null = the note uses
--     the full name only. Written only by the clinician's explicit, audited "Update chart
--     demographics" (POST /api/clients/[id]/identifying-info) or the client profile.
-- ============================================================================

ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "namePrefix" TEXT;
