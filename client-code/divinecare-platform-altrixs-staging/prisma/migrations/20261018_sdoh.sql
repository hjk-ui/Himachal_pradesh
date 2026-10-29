-- ============================================================================
-- MIGRATION: 20261018_sdoh.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: /dashboard/sdoh moves from a hand-entered module list to per-client records:
--   CMS AHC HRSN screenings, social-needs referrals worked to closure, and an org
--   community resource directory. See src/lib/sdoh/*.
-- ADDS:
--   * table sdoh_screenings  (one row per completed screening; answers JSONB)
--   * table sdoh_referrals   (open -> connected -> closed)
--   * table sdoh_resources   (org directory; unique (organizationId, source, legacyId))
-- NOT TOUCHED: ClinicModuleState 'sdoh-resources' / 'sdoh-screenings' rows stay as they are.
--   No resources are seeded: staff copy the old list with the page's
--   "Import existing resource list" button (source = 'legacy') or add their own.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sdoh_screenings (
  "id"                   TEXT PRIMARY KEY,
  "organizationId"       TEXT NOT NULL,
  "clientId"             TEXT NOT NULL,
  "instrument"           TEXT NOT NULL DEFAULT 'AHC_HRSN',
  "version"              TEXT NOT NULL,
  "answers"              JSONB NOT NULL,
  "includesSupplemental" BOOLEAN NOT NULL DEFAULT FALSE,
  "positiveDomains"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "safetyScore"          INTEGER,
  "respondent"           TEXT NOT NULL DEFAULT 'self',
  "source"               TEXT NOT NULL DEFAULT 'staff',
  "completedById"        TEXT,
  "completedByName"      TEXT,
  "completedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedZCodes"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "zCodesConfirmedAt"    TIMESTAMP(3),
  "zCodesConfirmedById"  TEXT,
  "riskAlertId"          TEXT,
  "notes"                TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "sdoh_screenings_organizationId_clientId_completedAt_idx"
  ON sdoh_screenings ("organizationId", "clientId", "completedAt");
CREATE INDEX IF NOT EXISTS "sdoh_screenings_organizationId_completedAt_idx"
  ON sdoh_screenings ("organizationId", "completedAt");

CREATE TABLE IF NOT EXISTS sdoh_referrals (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "screeningId"    TEXT,
  "domain"         TEXT NOT NULL,
  "resourceId"     TEXT,
  "status"         TEXT NOT NULL DEFAULT 'open',
  "ownerId"        TEXT,
  "ownerName"      TEXT,
  "notes"          TEXT,
  "connectedAt"    TIMESTAMP(3),
  "closedAt"       TIMESTAMP(3),
  "closeReason"    TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "sdoh_referrals_organizationId_status_idx" ON sdoh_referrals ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "sdoh_referrals_organizationId_clientId_idx" ON sdoh_referrals ("organizationId", "clientId");

CREATE TABLE IF NOT EXISTS sdoh_resources (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "domains"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "address"          TEXT,
  "city"             TEXT,
  "state"            TEXT,
  "postalCode"       TEXT,
  "phone"            TEXT,
  "website"          TEXT,
  "hours"            TEXT,
  "languages"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cost"             TEXT,
  "eligibilityNotes" TEXT,
  "active"           BOOLEAN NOT NULL DEFAULT TRUE,
  "source"           TEXT NOT NULL DEFAULT 'manual',
  "legacyId"         TEXT,
  "lastVerifiedAt"   TIMESTAMP(3),
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "sdoh_resources_organizationId_source_legacyId_key"
  ON sdoh_resources ("organizationId", "source", "legacyId");
CREATE INDEX IF NOT EXISTS "sdoh_resources_organizationId_active_idx" ON sdoh_resources ("organizationId", "active");

-- Tenant / client integrity (added only when missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdoh_screenings_clientId_fkey') THEN
    ALTER TABLE sdoh_screenings ADD CONSTRAINT "sdoh_screenings_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdoh_referrals_clientId_fkey') THEN
    ALTER TABLE sdoh_referrals ADD CONSTRAINT "sdoh_referrals_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdoh_resources_organizationId_fkey') THEN
    ALTER TABLE sdoh_resources ADD CONSTRAINT "sdoh_resources_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
