-- ============================================================================
-- MIGRATION: 20261022_intensive_programs.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Intensive outpatient (MH IOP, SUD IOP / ASAM 2.1) and partial hospitalization (PHP,
--   ASAM 2.5 / MH PHP) had no module: no program setup, admissions, daily attendance with
--   minutes, weekly hours against the program minimum, authorization units, discharge /
--   step-down with a 7-day follow-up check, or charge drafts. /dashboard/programs/intensive.
-- ADDS:
--   * table intensive_programs        (program per location: type, age group, schedule, policy
--                                      settings (null = default, "practice policy, confirm"),
--                                      billing codes / unit rules; no fees)
--   * table intensive_enrollments     (referral -> screening -> admission -> discharge episode)
--   * table intensive_attendance      (per client, per day, per schedule block: status + minutes)
--   * table intensive_follow_ups      (missed-day outreach task with logged attempts)
--   * table intensive_weekly_reviews  (weekly team review; PHP prescriber review)
--   * table intensive_charge_drafts   (claim DRAFTS from attendance; never submitted here)
-- NOT TOUCHED: no rows are seeded. PHP programs are created inactive until the practice
--   confirms PHP licensure. SUD IOP rows carry part2 = TRUE (42 CFR Part 2).
-- ============================================================================

CREATE TABLE IF NOT EXISTS intensive_programs (
  "id"                     TEXT PRIMARY KEY,
  "organizationId"         TEXT NOT NULL,
  "locationId"             TEXT,
  "name"                   TEXT NOT NULL,
  "programType"            TEXT NOT NULL,
  "ageGroup"               TEXT NOT NULL DEFAULT 'adult',
  "active"                 BOOLEAN NOT NULL DEFAULT TRUE,
  "phpLicensureConfirmed"  BOOLEAN NOT NULL DEFAULT FALSE,
  "scheduleTemplate"       JSONB,
  "minWeeklyHours"         DOUBLE PRECISION,
  "initialPlanDays"        INTEGER,
  "planReviewDays"         INTEGER,
  "authRenewalLeadDays"    INTEGER,
  "followUpWindowDays"     INTEGER,
  "missedDayOutreachHours" INTEGER,
  "billingMode"            TEXT NOT NULL DEFAULT 'per_diem',
  "perDiemCode"            TEXT,
  "serviceCodes"           JSONB,
  "unitRules"              JSONB,
  "linkedGroupIds"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "part2"                  BOOLEAN NOT NULL DEFAULT FALSE,
  "policyConfirmedAt"      TIMESTAMP(3),
  "policyConfirmedById"    TEXT,
  "policyConfirmedByName"  TEXT,
  "createdById"            TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "intensive_programs_organizationId_active_idx"
  ON intensive_programs ("organizationId", "active");

CREATE TABLE IF NOT EXISTS intensive_enrollments (
  "id"                     TEXT PRIMARY KEY,
  "organizationId"         TEXT NOT NULL,
  "programId"              TEXT NOT NULL,
  "clientId"               TEXT NOT NULL,
  "status"                 TEXT NOT NULL DEFAULT 'referred',
  "referralDate"           DATE NOT NULL,
  "referralSource"         TEXT,
  "referralReason"         TEXT,
  "screening"              JSONB,
  "priorAuthId"            TEXT,
  "psychEvalDate"          DATE,
  "psychEvalNoteId"        TEXT,
  "admissionDate"          DATE,
  "primaryClinicianId"     TEXT,
  "prescriberId"           TEXT,
  "caseManagerId"          TEXT,
  "treatmentPlanId"        TEXT,
  "dischargeDate"          DATE,
  "dischargeReason"        TEXT,
  "stepDownLevel"          TEXT,
  "aftercarePlan"          TEXT,
  "dischargeSummaryNoteId" TEXT,
  "followUpAppointmentId"  TEXT,
  "followUpDate"           DATE,
  "followUpProvider"       TEXT,
  "transitionNotes"        TEXT,
  "part2"                  BOOLEAN NOT NULL DEFAULT FALSE,
  "createdById"            TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "intensive_enrollments_organizationId_programId_status_idx"
  ON intensive_enrollments ("organizationId", "programId", "status");
CREATE INDEX IF NOT EXISTS "intensive_enrollments_organizationId_clientId_idx"
  ON intensive_enrollments ("organizationId", "clientId");

CREATE TABLE IF NOT EXISTS intensive_attendance (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "programId"        TEXT NOT NULL,
  "enrollmentId"     TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  "serviceDate"      DATE NOT NULL,
  "blockKey"         TEXT NOT NULL,
  "sessionType"      TEXT NOT NULL,
  "status"           TEXT NOT NULL,
  "minutes"          INTEGER,
  "scheduledMinutes" INTEGER,
  "progressNoteId"   TEXT,
  "groupSessionId"   TEXT,
  "note"             TEXT,
  "recordedById"     TEXT,
  "recordedByName"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "intensive_attendance_enrollmentId_serviceDate_blockKey_key"
  ON intensive_attendance ("enrollmentId", "serviceDate", "blockKey");
CREATE INDEX IF NOT EXISTS "intensive_attendance_organizationId_programId_serviceDate_idx"
  ON intensive_attendance ("organizationId", "programId", "serviceDate");
CREATE INDEX IF NOT EXISTS "intensive_attendance_organizationId_clientId_serviceDate_idx"
  ON intensive_attendance ("organizationId", "clientId", "serviceDate");

CREATE TABLE IF NOT EXISTS intensive_follow_ups (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "programId"      TEXT NOT NULL,
  "enrollmentId"   TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "serviceDate"    DATE NOT NULL,
  "assignedToId"   TEXT,
  "dueAt"          TIMESTAMP(3) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'open',
  "attempts"       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "outcome"        TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "intensive_follow_ups_enrollmentId_serviceDate_key"
  ON intensive_follow_ups ("enrollmentId", "serviceDate");
CREATE INDEX IF NOT EXISTS "intensive_follow_ups_organizationId_status_dueAt_idx"
  ON intensive_follow_ups ("organizationId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "intensive_follow_ups_assignedToId_status_idx"
  ON intensive_follow_ups ("assignedToId", "status");

CREATE TABLE IF NOT EXISTS intensive_weekly_reviews (
  "id"                       TEXT PRIMARY KEY,
  "organizationId"           TEXT NOT NULL,
  "enrollmentId"             TEXT NOT NULL,
  "clientId"                 TEXT NOT NULL,
  "weekStart"                DATE NOT NULL,
  "summary"                  TEXT NOT NULL,
  "hoursAttended"            DOUBLE PRECISION,
  "planChanges"              TEXT,
  "levelOfCareDecision"      TEXT,
  "reviewedById"             TEXT NOT NULL,
  "reviewedByName"           TEXT,
  "reviewedByRole"           TEXT,
  "prescriberReviewedById"   TEXT,
  "prescriberReviewedByName" TEXT,
  "prescriberReviewedAt"     TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "intensive_weekly_reviews_enrollmentId_weekStart_key"
  ON intensive_weekly_reviews ("enrollmentId", "weekStart");
CREATE INDEX IF NOT EXISTS "intensive_weekly_reviews_organizationId_weekStart_idx"
  ON intensive_weekly_reviews ("organizationId", "weekStart");

CREATE TABLE IF NOT EXISTS intensive_charge_drafts (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "programId"      TEXT NOT NULL,
  "enrollmentId"   TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "serviceDate"    DATE NOT NULL,
  "code"           TEXT NOT NULL,
  "units"          INTEGER NOT NULL,
  "minutes"        INTEGER NOT NULL,
  "sourceKey"      TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'draft',
  "holdReasons"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "priorAuthId"    TEXT,
  "part2"          BOOLEAN NOT NULL DEFAULT FALSE,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "intensive_charge_drafts_enrollmentId_serviceDate_code_sourceKey_key"
  ON intensive_charge_drafts ("enrollmentId", "serviceDate", "code", "sourceKey");
CREATE INDEX IF NOT EXISTS "intensive_charge_drafts_organizationId_serviceDate_idx"
  ON intensive_charge_drafts ("organizationId", "serviceDate");
CREATE INDEX IF NOT EXISTS "intensive_charge_drafts_organizationId_status_idx"
  ON intensive_charge_drafts ("organizationId", "status");

-- Drafts are never submitted from the intensive module: only draft / held / void.
DO $$ BEGIN
  ALTER TABLE intensive_charge_drafts
    ADD CONSTRAINT intensive_charge_drafts_status_chk CHECK ("status" IN ('draft', 'held', 'void'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SUD IOP is a 42 CFR Part 2 program.
DO $$ BEGIN
  ALTER TABLE intensive_programs
    ADD CONSTRAINT intensive_programs_sud_part2_chk CHECK ("programType" <> 'SUD_IOP' OR "part2" = TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
