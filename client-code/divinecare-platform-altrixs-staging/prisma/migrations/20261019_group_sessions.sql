-- ============================================================================
-- MIGRATION: 20261019_group_sessions.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No rows are written.
-- WHY: /dashboard/ehr/group-sessions kept every group, roster, attendance mark and group
--   note in ONE org-wide JSON blob (ClinicModuleState module 'group-sessions'), with no API.
--   Group attendance never became a progress note in the client's chart or a claim.
-- ADDS:
--   * clinical_groups            one row per group. kind = psychotherapy | sud (SUD group
--                                counseling is a separate area; a group never switches kind
--                                once it has notes). SUD groups are 42 CFR Part 2 (part2 = true).
--   * clinical_group_members     roster: client, join / leave dates, status, reason.
--   * clinical_group_sessions    one row per occurrence (recurring via the series helpers),
--                                shared group note section, recorded group size.
--   * clinical_group_attendance  one row per member per session: present / late / left early /
--                                absent / excused, minutes, the member's individual note fields,
--                                and the ProgressNote created in THAT client's chart.
--   * "Appointment"."groupSessionId"  per-member appointment linked to the group occurrence.
-- NOT TOUCHED: the old blob stays in ClinicModuleState (read-only). Copy it with
--   scripts/migrate-group-sessions-blob.ts (dry run by default).
-- ============================================================================

CREATE TABLE IF NOT EXISTS clinical_groups (
  "id"                     TEXT PRIMARY KEY,
  "organizationId"         TEXT NOT NULL,
  "kind"                   TEXT NOT NULL,
  "groupType"              TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "description"            TEXT,
  "program"                TEXT,
  "facilitatorId"          TEXT,
  "coFacilitatorId"        TEXT,
  "locationId"             VARCHAR(50),
  "room"                   TEXT,
  "telehealth"             BOOLEAN NOT NULL DEFAULT FALSE,
  "capacity"               INTEGER NOT NULL DEFAULT 10,
  "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "billingCode"            TEXT,
  "billingMode"            TEXT NOT NULL DEFAULT 'per_session',
  "minBillableMinutes"     INTEGER,
  "maxBillableGroupSize"   INTEGER,
  "enrollment"             TEXT NOT NULL DEFAULT 'open',
  "status"                 TEXT NOT NULL DEFAULT 'active',
  "part2"                  BOOLEAN NOT NULL DEFAULT FALSE,
  "recurFrequency"         TEXT,
  "recurInterval"          INTEGER,
  "recurWeekdays"          INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "recurStartTime"         TEXT,
  "recurStartDate"         DATE,
  "recurEndDate"           DATE,
  "legacySourceId"         TEXT,
  "createdById"            TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "clinical_groups_organizationId_kind_status_idx"
  ON clinical_groups ("organizationId", "kind", "status");
CREATE INDEX IF NOT EXISTS "clinical_groups_facilitatorId_idx" ON clinical_groups ("facilitatorId");
CREATE UNIQUE INDEX IF NOT EXISTS "clinical_groups_organizationId_legacySourceId_key"
  ON clinical_groups ("organizationId", "legacySourceId");

DO $$ BEGIN
  ALTER TABLE clinical_groups ADD CONSTRAINT "clinical_groups_kind_check" CHECK ("kind" IN ('psychotherapy', 'sud'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE clinical_groups ADD CONSTRAINT "clinical_groups_billingMode_check" CHECK ("billingMode" IN ('per_session', 'attendance_only'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  -- Every SUD group is 42 CFR Part 2
  ALTER TABLE clinical_groups ADD CONSTRAINT "clinical_groups_sud_part2_check" CHECK ("kind" <> 'sud' OR "part2" = TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE clinical_groups ADD CONSTRAINT "clinical_groups_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS clinical_group_members (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "groupId"        TEXT NOT NULL REFERENCES clinical_groups("id") ON DELETE CASCADE,
  "clientId"       TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "joinedOn"       DATE NOT NULL,
  "leftOn"         DATE,
  "leftReason"     TEXT,
  "addedById"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "clinical_group_members_groupId_clientId_key"
  ON clinical_group_members ("groupId", "clientId");
CREATE INDEX IF NOT EXISTS "clinical_group_members_organizationId_clientId_idx"
  ON clinical_group_members ("organizationId", "clientId");
DO $$ BEGIN
  ALTER TABLE clinical_group_members ADD CONSTRAINT "clinical_group_members_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS clinical_group_sessions (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "groupId"           TEXT NOT NULL REFERENCES clinical_groups("id") ON DELETE CASCADE,
  "startsAt"          TIMESTAMP(3) NOT NULL,
  "endsAt"            TIMESTAMP(3) NOT NULL,
  "durationMinutes"   INTEGER NOT NULL,
  "telehealth"        BOOLEAN NOT NULL DEFAULT FALSE,
  "locationId"        VARCHAR(50),
  "room"              TEXT,
  "status"            TEXT NOT NULL DEFAULT 'scheduled',
  "cancelReason"      TEXT,
  "facilitatorId"     TEXT,
  "coFacilitatorId"   TEXT,
  "topic"             TEXT,
  "sharedNote"        JSONB,
  "sharedUpdatedAt"   TIMESTAMP(3),
  "sharedUpdatedById" TEXT,
  "groupSize"         INTEGER,
  "part2"             BOOLEAN NOT NULL DEFAULT FALSE,
  "fromRecurrence"    BOOLEAN NOT NULL DEFAULT FALSE,
  "legacySourceId"    TEXT,
  "createdById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "clinical_group_sessions_groupId_startsAt_key"
  ON clinical_group_sessions ("groupId", "startsAt");
CREATE INDEX IF NOT EXISTS "clinical_group_sessions_organizationId_startsAt_idx"
  ON clinical_group_sessions ("organizationId", "startsAt");
CREATE INDEX IF NOT EXISTS "clinical_group_sessions_facilitatorId_startsAt_idx"
  ON clinical_group_sessions ("facilitatorId", "startsAt");

CREATE TABLE IF NOT EXISTS clinical_group_attendance (
  "id"                  TEXT PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "sessionId"           TEXT NOT NULL REFERENCES clinical_group_sessions("id") ON DELETE CASCADE,
  "groupId"             TEXT NOT NULL,
  "clientId"            TEXT NOT NULL,
  "memberId"            TEXT,
  "status"              TEXT NOT NULL DEFAULT 'unmarked',
  "minutesAttended"     INTEGER,
  "patientLocationType" TEXT,
  "individualNote"      JSONB,
  "progressNoteId"      TEXT,
  "appointmentId"       TEXT,
  "markedById"          TEXT,
  "markedAt"            TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "clinical_group_attendance_sessionId_clientId_key"
  ON clinical_group_attendance ("sessionId", "clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "clinical_group_attendance_progressNoteId_key"
  ON clinical_group_attendance ("progressNoteId");
CREATE INDEX IF NOT EXISTS "clinical_group_attendance_organizationId_clientId_idx"
  ON clinical_group_attendance ("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "clinical_group_attendance_groupId_idx" ON clinical_group_attendance ("groupId");
DO $$ BEGIN
  ALTER TABLE clinical_group_attendance ADD CONSTRAINT "clinical_group_attendance_status_check"
    CHECK ("status" IN ('unmarked', 'present', 'late', 'left_early', 'absent', 'excused'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE clinical_group_attendance ADD CONSTRAINT "clinical_group_attendance_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE clinical_group_attendance ADD CONSTRAINT "clinical_group_attendance_progressNoteId_fkey"
    FOREIGN KEY ("progressNoteId") REFERENCES "ProgressNote"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-member appointment linked to the group occurrence (facilitator calendar + member's visits)
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "groupSessionId" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_groupSessionId_idx" ON "Appointment" ("groupSessionId");
DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_groupSessionId_fkey"
    FOREIGN KEY ("groupSessionId") REFERENCES clinical_group_sessions("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
