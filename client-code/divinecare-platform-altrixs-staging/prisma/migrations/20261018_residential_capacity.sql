-- ============================================================================
-- MIGRATION: 20261018_residential_capacity.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Residential bed counts were hard-coded (ASAM 3.5: 8 beds, 3.1: 6 beds on the
--   residential page; 14 in /api/residential/bed-board). Occupancy, open beds and the
--   practice census need the practice's real capacity, per location and ASAM level.
-- ADDS:
--   * table residential_capacity (one row per organization + location + ASAM level:
--     beds, optional room labels). Edited in Practice settings > Programs & capacity.
-- NOT TOUCHED: no rows are seeded. Until the practice enters its beds, every screen
--   shows "Beds not configured" (no default bed counts).
-- ============================================================================

CREATE TABLE IF NOT EXISTS residential_capacity (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "locationId"     TEXT NOT NULL,
  "asamLevel"      TEXT NOT NULL,
  "beds"           INTEGER NOT NULL,
  "rooms"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note"           TEXT,
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "residential_capacity_organizationId_locationId_asamLevel_key"
  ON residential_capacity ("organizationId", "locationId", "asamLevel");
CREATE INDEX IF NOT EXISTS "residential_capacity_organizationId_idx"
  ON residential_capacity ("organizationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'residential_capacity_beds_check') THEN
    ALTER TABLE residential_capacity ADD CONSTRAINT residential_capacity_beds_check CHECK ("beds" >= 0 AND "beds" <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'residential_capacity_level_check') THEN
    ALTER TABLE residential_capacity ADD CONSTRAINT residential_capacity_level_check CHECK ("asamLevel" IN ('3.1', '3.5', '3.7'));
  END IF;
END $$;
