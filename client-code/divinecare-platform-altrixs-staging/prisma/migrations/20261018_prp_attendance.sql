-- ============================================================================
-- MIGRATION: 20261018_prp_attendance.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: The PRP hub (/dashboard/prp) had no store for groups or attendance, so PRP
--   encounters could not be recorded and every hub number was a fixed placeholder.
--   TMS sessions had no place for the motor threshold, and AOT participants had no
--   organization column (unlinked participants could not be tenant-scoped).
-- ADDS:
--   * table prp_groups        (org PRP groups; no PHI)
--   * table prp_attendance    (one row per PRP encounter: group check-off or individual/community)
--   * table prp_mors_ratings  (Milestones of Recovery Scale 1-8, one per enrollment per month)
--   * "PrpEnrollment"."statusChangedAt", "dischargedAt", "dischargeReason"
--   * "TmsSession"."motorThresholdPct"
--   * "AotParticipant"."organizationId" (+ backfill from the linked client's organization)
-- NOT TOUCHED: no rows are seeded. AOT participants with no linked client stay
--   organizationId NULL and are hidden from every org until staff relink them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS prp_groups (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "schedule"        TEXT,
  "facilitatorId"   TEXT,
  "facilitatorName" TEXT,
  "location"        TEXT,
  "active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "prp_groups_organizationId_active_idx"
  ON prp_groups ("organizationId", "active");

CREATE TABLE IF NOT EXISTS prp_attendance (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "enrollmentId"   TEXT NOT NULL,
  "groupId"        TEXT,
  "serviceDate"    TIMESTAMP(3) NOT NULL,
  "minutes"        INTEGER,
  "serviceType"    TEXT NOT NULL,
  "billable"       BOOLEAN NOT NULL DEFAULT TRUE,
  "note"           TEXT,
  "recordedById"   TEXT,
  "recordedByName" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "prp_attendance_organizationId_serviceDate_idx"
  ON prp_attendance ("organizationId", "serviceDate");
CREATE INDEX IF NOT EXISTS "prp_attendance_organizationId_enrollmentId_serviceDate_idx"
  ON prp_attendance ("organizationId", "enrollmentId", "serviceDate");
CREATE INDEX IF NOT EXISTS "prp_attendance_organizationId_groupId_serviceDate_idx"
  ON prp_attendance ("organizationId", "groupId", "serviceDate");

CREATE TABLE IF NOT EXISTS prp_mors_ratings (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "enrollmentId"   TEXT NOT NULL,
  "month"          TEXT NOT NULL,
  "rating"         INTEGER NOT NULL,
  "note"           TEXT,
  "ratedById"      TEXT,
  "ratedByName"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "prp_mors_ratings_enrollmentId_month_key"
  ON prp_mors_ratings ("enrollmentId", "month");
CREATE INDEX IF NOT EXISTS "prp_mors_ratings_organizationId_month_idx"
  ON prp_mors_ratings ("organizationId", "month");

ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3);
ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "dischargedAt" TIMESTAMP(3);
ALTER TABLE "PrpEnrollment" ADD COLUMN IF NOT EXISTS "dischargeReason" TEXT;

ALTER TABLE "TmsSession" ADD COLUMN IF NOT EXISTS "motorThresholdPct" DOUBLE PRECISION;

ALTER TABLE "AotParticipant" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "AotParticipant_organizationId_idx" ON "AotParticipant" ("organizationId");
-- Backfill from the linked chart only (Client.organizationId); unlinked rows stay NULL.
UPDATE "AotParticipant" a
   SET "organizationId" = c."organizationId"
  FROM "Client" c
 WHERE a."clientId" = c."id"
   AND a."organizationId" IS NULL
   AND c."organizationId" IS NOT NULL;
