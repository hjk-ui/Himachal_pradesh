-- ============================================================================
-- MIGRATION: 20261018_peer_support.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: /dashboard/peer-support moves from hand-entered module lists (free-text client
--   names, not tied to a chart) to per-client records scoped to the peer's caseload.
--   See src/lib/peerSupport/*.
-- ADDS:
--   * table peer_contacts   (one row per peer contact; non-clinical peer note; follow-up)
--   * table peer_goals      (recovery goal in the client's words; appended progress notes)
--   * table peer_placements (community integration placement; optional sdoh_resources link)
-- NOT TOUCHED: ClinicModuleState 'peer-contacts' / 'peer-goals' / 'peer-placements' /
--   'peer-meta' rows stay as they are. Nothing is copied automatically: a user files each
--   old entry to a client they pick ("Import legacy entries", source = 'legacy').
-- ============================================================================

CREATE TABLE IF NOT EXISTS peer_contacts (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  "peerUserId"       TEXT NOT NULL,
  "peerName"         TEXT,
  "contactAt"        TIMESTAMP(3) NOT NULL,
  "mode"             TEXT NOT NULL,
  "durationMinutes"  INTEGER,
  "topics"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "goalIds"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"            TEXT,
  "followUpAt"       TIMESTAMP(3),
  "followUpDoneAt"   TIMESTAMP(3),
  "followUpDoneById" TEXT,
  "voidedAt"         TIMESTAMP(3),
  "voidedById"       TEXT,
  "voidReason"       TEXT,
  "source"           TEXT NOT NULL DEFAULT 'manual',
  "legacyId"         TEXT,
  "legacyData"       JSONB,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "peer_contacts_organizationId_source_legacyId_key"
  ON peer_contacts ("organizationId", "source", "legacyId");
CREATE INDEX IF NOT EXISTS "peer_contacts_organizationId_clientId_contactAt_idx"
  ON peer_contacts ("organizationId", "clientId", "contactAt");
CREATE INDEX IF NOT EXISTS "peer_contacts_organizationId_peerUserId_contactAt_idx"
  ON peer_contacts ("organizationId", "peerUserId", "contactAt");
CREATE INDEX IF NOT EXISTS "peer_contacts_organizationId_followUpAt_idx"
  ON peer_contacts ("organizationId", "followUpAt");

CREATE TABLE IF NOT EXISTS peer_goals (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "peerUserId"     TEXT NOT NULL,
  "peerName"       TEXT,
  "goal"           TEXT NOT NULL,
  "domain"         TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "targetDate"     TIMESTAMP(3),
  "progressNotes"  JSONB NOT NULL DEFAULT '[]'::jsonb,
  "achievedAt"     TIMESTAMP(3),
  "source"         TEXT NOT NULL DEFAULT 'manual',
  "legacyId"       TEXT,
  "legacyData"     JSONB,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "peer_goals_organizationId_source_legacyId_key"
  ON peer_goals ("organizationId", "source", "legacyId");
CREATE INDEX IF NOT EXISTS "peer_goals_organizationId_clientId_status_idx"
  ON peer_goals ("organizationId", "clientId", "status");

CREATE TABLE IF NOT EXISTS peer_placements (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  "peerUserId"       TEXT NOT NULL,
  "peerName"         TEXT,
  "placementType"    TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "resourceId"       TEXT,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "startDate"        TIMESTAMP(3),
  "endDate"          TIMESTAMP(3),
  "hoursPerWeek"     DOUBLE PRECISION,
  "notes"            TEXT,
  "source"           TEXT NOT NULL DEFAULT 'manual',
  "legacyId"         TEXT,
  "legacyData"       JSONB,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "peer_placements_organizationId_source_legacyId_key"
  ON peer_placements ("organizationId", "source", "legacyId");
CREATE INDEX IF NOT EXISTS "peer_placements_organizationId_clientId_status_idx"
  ON peer_placements ("organizationId", "clientId", "status");

-- Tenant / client integrity (added only when missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peer_contacts_clientId_fkey') THEN
    ALTER TABLE peer_contacts ADD CONSTRAINT "peer_contacts_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peer_goals_clientId_fkey') THEN
    ALTER TABLE peer_goals ADD CONSTRAINT "peer_goals_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peer_placements_clientId_fkey') THEN
    ALTER TABLE peer_placements ADD CONSTRAINT "peer_placements_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- 20261018_sdoh.sql sorts after this file: link only once sdoh_resources exists (re-run adds it).
  IF to_regclass('sdoh_resources') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peer_placements_resourceId_fkey') THEN
    ALTER TABLE peer_placements ADD CONSTRAINT "peer_placements_resourceId_fkey"
      FOREIGN KEY ("resourceId") REFERENCES sdoh_resources("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
