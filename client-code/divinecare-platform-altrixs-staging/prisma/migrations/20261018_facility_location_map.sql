-- ============================================================================
-- MIGRATION: 20261018_facility_location_map.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: locations from imports (src/lib/locations, Admin › Locations)
--   * "FacilityLocationMap": Valant facility name -> Altrixs Location, or a program
--     (Family Practice = primary care, IOP, PRP). Rows are created only by the owner
--     ("Apply suggested mapping", a row edit on Admin › Locations, or the Valant facility
--     list import), with the facility's billing entity name, time zone and active flag.
--   * "ClientLocationChange": one row per client moved by an owner-triggered
--     "Recompute client locations" run, with the previous location so the run can be undone.
--   Plain id columns, no foreign keys (same pattern as the Waystar inbound tables).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "FacilityLocationMap" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "sourceSystem"      TEXT NOT NULL DEFAULT 'valant',
  "facilityName"      TEXT NOT NULL,
  "kind"              TEXT NOT NULL DEFAULT 'location',
  "locationId"        TEXT,
  "programKey"        TEXT,
  "needsConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "note"              TEXT,
  "origin"            TEXT NOT NULL DEFAULT 'owner',
  "billingEntityName" TEXT,
  "timezone"          TEXT,
  "sourceActive"      BOOLEAN,
  "facilityImportedAt" TIMESTAMP(3),
  "updatedById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacilityLocationMap_pkey" PRIMARY KEY ("id")
);

-- Valant facility list attributes (Admin › Data import › Import Facilities); safe if the table predates them
ALTER TABLE "FacilityLocationMap" ADD COLUMN IF NOT EXISTS "billingEntityName" TEXT;
ALTER TABLE "FacilityLocationMap" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "FacilityLocationMap" ADD COLUMN IF NOT EXISTS "sourceActive" BOOLEAN;
ALTER TABLE "FacilityLocationMap" ADD COLUMN IF NOT EXISTS "facilityImportedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "FacilityLocationMap_organizationId_sourceSystem_facilityName_key"
  ON "FacilityLocationMap" ("organizationId", "sourceSystem", "facilityName");
CREATE INDEX IF NOT EXISTS "FacilityLocationMap_organizationId_kind_idx"
  ON "FacilityLocationMap" ("organizationId", "kind");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FacilityLocationMap_kind_check') THEN
    ALTER TABLE "FacilityLocationMap"
      ADD CONSTRAINT "FacilityLocationMap_kind_check" CHECK ("kind" IN ('location', 'program', 'ignore'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ClientLocationChange" (
  "id"                 TEXT NOT NULL,
  "organizationId"     TEXT NOT NULL,
  "runId"              TEXT NOT NULL,
  "clientId"           TEXT NOT NULL,
  "previousLocationId" TEXT,
  "newLocationId"      TEXT,
  "evidence"           TEXT NOT NULL,
  "detail"             TEXT,
  "appliedById"        TEXT,
  "appliedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revertedAt"         TIMESTAMP(3),
  "revertedById"       TEXT,
  CONSTRAINT "ClientLocationChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientLocationChange_organizationId_runId_idx"
  ON "ClientLocationChange" ("organizationId", "runId");
CREATE INDEX IF NOT EXISTS "ClientLocationChange_organizationId_clientId_idx"
  ON "ClientLocationChange" ("organizationId", "clientId");
