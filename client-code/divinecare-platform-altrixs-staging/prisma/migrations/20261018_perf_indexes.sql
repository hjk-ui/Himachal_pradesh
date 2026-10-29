-- ============================================================================
-- MIGRATION: 20261018_perf_indexes.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. Indexes only (no data change).
-- WHY: Inbox, role home, population health and the scanners were slow on staging
--   (~15k clients / 3.5k active, 67k Valant transactions). These are the where clauses
--   that had no matching index:
--   * Appointment ("clientId", "startsAt"): session frequency, auth forecast and last-visit
--     aggregates read `clientId = ANY(ids) AND startsAt >= since` (only "clientId" was indexed).
--   * ClinicalAssessmentRecord ("organizationId", "instrumentId", "totalScore") and
--     ("organizationId", "safetyFlagged"): MBC alerts now read only flagged / over-threshold
--     rows (listMbcAlerts) instead of every assessment in the organization.
--   * ClinicalAssessmentRecord ("organizationId", "clientId", "createdAt"): latest C-SSRS per
--     client and the PHQ-9/GAD-7 window in population health.
--   * ProgressNote ("clinicianId", "createdAt"): "my unsigned notes older than the deadline".
--   * RiskAlert ("organizationId", "reviewed", "createdAt"): unreviewed alerts per org
--     (inbox, home counters, To-Do).
--   * SudRadarSignal ("organizationId", "status", "scannedAt"): radar list and inbox section.
--   * Client ("organizationId", "status") and ("organizationId", "assignedToId"): active
--     clients per org / per caseload behind every scoped client filter.
-- NOTE: plain CREATE INDEX (like the other migrations here) briefly blocks writes on each
--   table while it builds; run off-hours, or run each statement by hand with CONCURRENTLY
--   outside a transaction.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "Appointment_clientId_startsAt_idx"
  ON "Appointment" ("clientId", "startsAt");

CREATE INDEX IF NOT EXISTS "ClinicalAssessmentRecord_organizationId_instrumentId_totalScore_idx"
  ON "ClinicalAssessmentRecord" ("organizationId", "instrumentId", "totalScore");

CREATE INDEX IF NOT EXISTS "ClinicalAssessmentRecord_organizationId_safetyFlagged_idx"
  ON "ClinicalAssessmentRecord" ("organizationId", "safetyFlagged");

CREATE INDEX IF NOT EXISTS "ClinicalAssessmentRecord_organizationId_clientId_createdAt_idx"
  ON "ClinicalAssessmentRecord" ("organizationId", "clientId", "createdAt");

CREATE INDEX IF NOT EXISTS "ProgressNote_clinicianId_createdAt_idx"
  ON "ProgressNote" ("clinicianId", "createdAt");

CREATE INDEX IF NOT EXISTS "RiskAlert_organizationId_reviewed_createdAt_idx"
  ON "RiskAlert" ("organizationId", "reviewed", "createdAt");

CREATE INDEX IF NOT EXISTS "SudRadarSignal_organizationId_status_scannedAt_idx"
  ON "SudRadarSignal" ("organizationId", "status", "scannedAt");

CREATE INDEX IF NOT EXISTS "Client_organizationId_status_idx"
  ON "Client" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "Client_organizationId_assignedToId_idx"
  ON "Client" ("organizationId", "assignedToId");

ANALYZE "Appointment";
ANALYZE "ClinicalAssessmentRecord";
ANALYZE "ProgressNote";
ANALYZE "RiskAlert";
ANALYZE "SudRadarSignal";
ANALYZE "Client";
