-- ============================================================================
-- MIGRATION: 20261022_roles_followup_incidents.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: role audit follow-up (minimum necessary). Incident reports were one org-wide
--   ClinicModuleState list ('incidents'), so every role that may file an incident (front desk,
--   clinicians, physicians) read the whole practice's incidents. Now one row per report:
--   line staff see the reports they filed, that name them as involved staff or that are assigned
--   to them; leadership, Office Manager and a verified Medical Director review all.
-- Copy the old list with: npx tsx scripts/migrate-incidents-blob.ts (dry run) / --apply.
-- The old ClinicModuleState row is never changed or deleted by the copy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "IncidentReport" (
  "id"                 TEXT NOT NULL,
  "organizationId"     TEXT NOT NULL,
  "incidentNumber"     TEXT NOT NULL,
  "title"              TEXT NOT NULL,
  "type"               TEXT NOT NULL,
  "chartCategory"      TEXT,
  "severity"           TEXT NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'reported',
  "reporterUserId"     TEXT,
  "reportedByName"     TEXT,
  "involvedStaffIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "assignedToUserId"   TEXT,
  "assignedToName"     TEXT,
  "clientId"           TEXT,
  "clientInitials"     TEXT,
  "reportedDate"       TEXT NOT NULL,
  "reportedAtTime"     TIMESTAMP(3),
  "occurredAt"         TIMESTAMP(3),
  "dueFollowUp"        TEXT,
  "closedAt"           TEXT,
  "location"           TEXT,
  "description"        TEXT NOT NULL,
  "immediateAction"    TEXT,
  "investigationNotes" TEXT,
  "correctiveActions"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rootCause"          TEXT,
  "carfCategory"       TEXT,
  "errorExplanation"   TEXT,
  "legacySourceId"     TEXT,
  "updatedById"        TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IncidentReport_organizationId_incidentNumber_key" ON "IncidentReport" ("organizationId", "incidentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "IncidentReport_organizationId_legacySourceId_key" ON "IncidentReport" ("organizationId", "legacySourceId");
CREATE INDEX IF NOT EXISTS "IncidentReport_organizationId_reportedDate_idx" ON "IncidentReport" ("organizationId", "reportedDate");
CREATE INDEX IF NOT EXISTS "IncidentReport_reporterUserId_idx" ON "IncidentReport" ("reporterUserId");
CREATE INDEX IF NOT EXISTS "IncidentReport_assignedToUserId_idx" ON "IncidentReport" ("assignedToUserId");
CREATE INDEX IF NOT EXISTS "IncidentReport_clientId_idx" ON "IncidentReport" ("clientId");
