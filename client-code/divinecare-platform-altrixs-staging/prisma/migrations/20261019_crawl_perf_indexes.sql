-- ============================================================================
-- MIGRATION: 20261019_crawl_perf_indexes.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. Indexes only (no data change).
-- WHY: the Oct 19 per-role crawl of staging found slow pages for caseload / care-team roles.
--   These where clauses had no matching index:
--   * MedicalVisit ("providerId", "clientId"): the primary care care-team scope
--     (orgScope medicalCareTeamClientWhere: medicalVisits some providerId) behind every client
--     query a PHYSICIAN / MEDICAL_NP / MEDICAL_ASSISTANT makes; "providerId" was not indexed,
--     so each scoped query scanned the whole visit table.
--   * ClientTreatmentTeamMember ("providerId", "clientId") and Appointment ("clinicianId",
--     "clientId"): the same scope (peer support and primary care) as index-only semi-joins.
--   * ProgressNote ("clientId", "dateOfService"): reports, auth forecast and session frequency
--     filter notes by client and date of service (only "createdAt" was indexed per client).
--   * ProgressNote ("createdAt"): the EHR notes feed and the documentation productivity window
--     (newest notes org-wide, client filter applied after).
--   * MedicalCharge ("organizationId", "dos"): the medical billing worklist (newest first).
--   * rcopia_prescriptions ("lifecycle_status", "provider_npi"): the DrFirst badge fallback
--     (pending prescriptions per prescriber NPI).
-- NOTE: plain CREATE INDEX briefly blocks writes on each table while it builds; run off-hours,
--   or run each statement by hand with CONCURRENTLY outside a transaction.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "MedicalVisit_providerId_clientId_idx"
  ON "MedicalVisit" ("providerId", "clientId");

CREATE INDEX IF NOT EXISTS "ClientTreatmentTeamMember_providerId_clientId_idx"
  ON "ClientTreatmentTeamMember" ("providerId", "clientId");

CREATE INDEX IF NOT EXISTS "Appointment_clinicianId_clientId_idx"
  ON "Appointment" ("clinicianId", "clientId");

CREATE INDEX IF NOT EXISTS "ProgressNote_clientId_dateOfService_idx"
  ON "ProgressNote" ("clientId", "dateOfService");

CREATE INDEX IF NOT EXISTS "ProgressNote_createdAt_idx"
  ON "ProgressNote" ("createdAt");

CREATE INDEX IF NOT EXISTS "MedicalCharge_organizationId_dos_idx"
  ON "MedicalCharge" ("organizationId", "dos");

CREATE INDEX IF NOT EXISTS "rcopia_prescriptions_lifecycle_status_provider_npi_idx"
  ON "rcopia_prescriptions" ("lifecycle_status", "provider_npi");

ANALYZE "MedicalVisit";
ANALYZE "ClientTreatmentTeamMember";
ANALYZE "Appointment";
ANALYZE "ProgressNote";
ANALYZE "MedicalCharge";
ANALYZE "rcopia_prescriptions";
