-- ============================================================================
-- MIGRATION: 20261024_homebase_connector.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Owner-approved READ-ONLY Homebase (payroll / timekeeping) connector in the HR module.
--   Homebase stays the system of record for pay and time; Altrixs keeps a cached copy of
--   locations, the employee roster (name, email, job title, archived status; NO pay rates, wages,
--   phone numbers or addresses), shifts and timecards, plus the HR-reviewed links:
--     * HomebaseLocation.altrixsLocationId -> "Location".id (HR maps; auto-suggested by name)
--     * HomebaseEmployee.linkedUserId      -> "User".id (auto by email; name match = suggestion HR confirms)
--   Every row is organization-scoped; Homebase ids are unique per organization. Shifts / timecards
--   deleted in Homebase (the /deleted endpoints) keep their row with "deletedAt" set.
--   No PHI is stored here and nothing is ever sent to Homebase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "HomebaseLocation" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "homebaseId"        TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "city"              TEXT,
  "state"             TEXT,
  "altrixsLocationId" TEXT REFERENCES "Location"("id") ON DELETE SET NULL,
  "mappedById"        TEXT,
  "mappedAt"          TIMESTAMP(3),
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HomebaseLocation_organizationId_homebaseId_key" ON "HomebaseLocation"("organizationId", "homebaseId");

CREATE TABLE IF NOT EXISTS "HomebaseEmployee" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "homebaseId"         TEXT NOT NULL,
  "firstName"          TEXT,
  "lastName"           TEXT,
  "email"              TEXT,
  "jobTitle"           TEXT,
  -- active | archived | unknown
  "status"             TEXT NOT NULL DEFAULT 'unknown',
  "homebaseLocationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "linkedUserId"       TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  -- email (auto) | confirmed (HR) | suggested (name match, pending HR) | rejected (HR) | none
  "linkStatus"         TEXT NOT NULL DEFAULT 'none',
  "suggestedUserId"    TEXT,
  "linkedById"         TEXT,
  "linkedAt"           TIMESTAMP(3),
  "lastSeenAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HomebaseEmployee_organizationId_homebaseId_key" ON "HomebaseEmployee"("organizationId", "homebaseId");
CREATE INDEX IF NOT EXISTS "HomebaseEmployee_organizationId_linkedUserId_idx" ON "HomebaseEmployee"("organizationId", "linkedUserId");

CREATE TABLE IF NOT EXISTS "HomebaseShift" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "homebaseId"         TEXT NOT NULL,
  "homebaseLocationId" TEXT,
  "homebaseEmployeeId" TEXT,
  "startAt"            TIMESTAMP(3),
  "endAt"              TIMESTAMP(3),
  "roleLabel"          TEXT,
  "published"          BOOLEAN,
  "deletedAt"          TIMESTAMP(3),
  "syncedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HomebaseShift_organizationId_homebaseId_key" ON "HomebaseShift"("organizationId", "homebaseId");
CREATE INDEX IF NOT EXISTS "HomebaseShift_organizationId_homebaseEmployeeId_startAt_idx" ON "HomebaseShift"("organizationId", "homebaseEmployeeId", "startAt");

CREATE TABLE IF NOT EXISTS "HomebaseTimecard" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "homebaseId"         TEXT NOT NULL,
  "homebaseLocationId" TEXT,
  "homebaseEmployeeId" TEXT,
  "homebaseShiftId"    TEXT,
  "clockInAt"          TIMESTAMP(3),
  "clockOutAt"         TIMESTAMP(3),
  "breakMinutes"       INTEGER NOT NULL DEFAULT 0,
  "workedMinutes"      INTEGER,
  "approved"           BOOLEAN,
  "deletedAt"          TIMESTAMP(3),
  "syncedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HomebaseTimecard_organizationId_homebaseId_key" ON "HomebaseTimecard"("organizationId", "homebaseId");
CREATE INDEX IF NOT EXISTS "HomebaseTimecard_organizationId_homebaseEmployeeId_clockInAt_idx" ON "HomebaseTimecard"("organizationId", "homebaseEmployeeId", "clockInAt");

CREATE TABLE IF NOT EXISTS "HomebaseSyncRun" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  -- manual | cron
  "trigger"        TEXT NOT NULL,
  "triggeredById"  TEXT,
  "rangeStart"     DATE NOT NULL,
  "rangeEnd"       DATE NOT NULL,
  -- running | success | partial | failed
  "status"         TEXT NOT NULL DEFAULT 'running',
  -- counts only: { locations, employees, shifts, timecards, deletedShifts, deletedTimecards, requests, ... }
  "counts"         JSONB,
  "error"          TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "HomebaseSyncRun_organizationId_startedAt_idx" ON "HomebaseSyncRun"("organizationId", "startedAt");
