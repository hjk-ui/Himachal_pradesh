-- ============================================================================
-- MIGRATION: 20261019_client_valant_facility.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Practice overview / census "By facility" (src/lib/locations/facilityOverview.ts)
--   * Client."valantFacility": the Valant client export's assigned-facility value, exactly as
--     exported ("Assigned Fac Id" when the export has it, else "Assigned Fac Name", which is the
--     facility's billing entity, e.g. "MD Behavioral Health - PRP"). Written by the client import
--     (Admin > Data import > Clients, Valant), including the "facility only" re-import mode.
--   * NO BACKFILL: the client import never kept the raw Valant row, and the city it used
--     ("Assigned Fac Address (City)") does not identify a facility. Clients stay NULL until the
--     Valant client file is re-imported.
-- ============================================================================

ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "valantFacility" TEXT;
