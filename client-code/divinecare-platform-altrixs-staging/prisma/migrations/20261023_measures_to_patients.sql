-- ============================================================================
-- MIGRATION: 20261023_measures_to_patients.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No content rows are written.
-- WHY: outcome measures sent to patients before visits (Valant parity, done better). The MBC
--   schedules lived in one org-wide JSON blob (ClinicModuleState 'outcome-schedules') with no
--   per-client rows, no send / open / completion tracking, and "Portal / SMS delivery of measures
--   is not connected" on the page.
-- ADDS:
--   * measure_assignments  one row per client + measure: schedule once | interval (every N days) |
--                          before_visit, start / end, source manual | program | provider_rule |
--                          visit_rule | sud_radar | legacy, status active | paused | ended.
--                          "activeKey" (client:instrument while active, NULL otherwise) is unique per
--                          organization, so the rules / the SUD radar never open a measure twice.
--   * measure_requests     one send (link /m/<token>): token sha256 only, channel email | sms |
--                          portal | in_session, sent / opened / started / completed / expires (7 days)
--                          / DOB-locked times, linked appointment, resulting ClinicalAssessmentRecord
--                          ids, safety flag, Part 2 flag, clinician review time. dedupeKey
--                          (<appointmentId>:<stage>) is unique: one automatic send per visit and stage.
--   * ClinicalAssessmentRecord.source ('patient_portal' for patient-completed rows) + measureRequestId.
--   * PracticeSettings: mbcAutoSend, mbcVisitRule, mbcProgramRule, mbcProviderRule (all default OFF)
--     and mbcProgramMeasures / mbcProviderMeasures (JSON rule lists, default empty).
-- NOT TOUCHED: the old blob stays in ClinicModuleState (read-only). Copy it with
--   scripts/migrate-outcome-schedules-blob.ts (dry run by default).
-- ============================================================================

CREATE TABLE IF NOT EXISTS measure_assignments (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "clientId"        TEXT NOT NULL,
  "instrumentId"    TEXT NOT NULL,
  "schedule"        TEXT NOT NULL DEFAULT 'interval',
  "everyDays"       INTEGER,
  "startDate"       DATE NOT NULL,
  "endDate"         DATE,
  "source"          TEXT NOT NULL DEFAULT 'manual',
  "sourceRef"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'active',
  "activeKey"       TEXT,
  "assignedById"    TEXT,
  "lastSentAt"      TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "legacySourceId"  TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "measure_assignments_organizationId_activeKey_key"
  ON measure_assignments ("organizationId", "activeKey");
CREATE UNIQUE INDEX IF NOT EXISTS "measure_assignments_organizationId_legacySourceId_key"
  ON measure_assignments ("organizationId", "legacySourceId");
CREATE INDEX IF NOT EXISTS "measure_assignments_organizationId_clientId_idx" ON measure_assignments ("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "measure_assignments_organizationId_status_idx" ON measure_assignments ("organizationId", "status");

DO $$ BEGIN
  ALTER TABLE measure_assignments ADD CONSTRAINT "measure_assignments_schedule_check"
    CHECK ("schedule" IN ('once', 'interval', 'before_visit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_assignments ADD CONSTRAINT "measure_assignments_status_check"
    CHECK ("status" IN ('active', 'paused', 'ended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_assignments ADD CONSTRAINT "measure_assignments_source_check"
    CHECK ("source" IN ('manual', 'program', 'provider_rule', 'visit_rule', 'sud_radar', 'legacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_assignments ADD CONSTRAINT "measure_assignments_everyDays_check"
    CHECK ("everyDays" IS NULL OR ("everyDays" >= 1 AND "everyDays" <= 365));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_assignments ADD CONSTRAINT "measure_assignments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_assignments ADD CONSTRAINT "measure_assignments_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS measure_requests (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  "instrumentIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "assignmentIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tokenHash"        TEXT NOT NULL,
  "channel"          TEXT NOT NULL,
  "deliveryResults"  JSONB,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "notSentReason"    TEXT,
  "trigger"          TEXT NOT NULL DEFAULT 'manual',
  "dedupeKey"        TEXT,
  "appointmentId"    TEXT,
  "clinicianId"      TEXT,
  "sentById"         TEXT,
  "sentAt"           TIMESTAMP(3),
  "openedAt"         TIMESTAMP(3),
  "startedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "lockedAt"         TIMESTAMP(3),
  "dobAttempts"      INTEGER NOT NULL DEFAULT 0,
  "sessionHash"      TEXT,
  "sessionExpiresAt" TIMESTAMP(3),
  "partialAnswers"   JSONB,
  "resultRecordIds"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "safetyFlagged"    BOOLEAN NOT NULL DEFAULT FALSE,
  "part2"            BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewedAt"       TIMESTAMP(3),
  "reviewedById"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "measure_requests_tokenHash_key" ON measure_requests ("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "measure_requests_dedupeKey_key" ON measure_requests ("dedupeKey");
CREATE INDEX IF NOT EXISTS "measure_requests_organizationId_clientId_createdAt_idx" ON measure_requests ("organizationId", "clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "measure_requests_organizationId_status_idx" ON measure_requests ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "measure_requests_organizationId_clinicianId_completedAt_idx" ON measure_requests ("organizationId", "clinicianId", "completedAt");
CREATE INDEX IF NOT EXISTS "measure_requests_appointmentId_idx" ON measure_requests ("appointmentId");

DO $$ BEGIN
  ALTER TABLE measure_requests ADD CONSTRAINT "measure_requests_channel_check"
    CHECK ("channel" IN ('email', 'sms', 'portal', 'in_session'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_requests ADD CONSTRAINT "measure_requests_status_check"
    CHECK ("status" IN ('pending', 'sent', 'not_sent', 'opened', 'started', 'completed', 'expired', 'locked', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_requests ADD CONSTRAINT "measure_requests_trigger_check"
    CHECK ("trigger" IN ('manual', 'visit_3d', 'visit_1d'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_requests ADD CONSTRAINT "measure_requests_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE measure_requests ADD CONSTRAINT "measure_requests_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ClinicalAssessmentRecord" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "ClinicalAssessmentRecord" ADD COLUMN IF NOT EXISTS "measureRequestId" TEXT;

ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mbcAutoSend" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mbcVisitRule" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mbcProgramRule" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mbcProviderRule" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mbcProgramMeasures" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mbcProviderMeasures" JSONB NOT NULL DEFAULT '[]'::jsonb;
