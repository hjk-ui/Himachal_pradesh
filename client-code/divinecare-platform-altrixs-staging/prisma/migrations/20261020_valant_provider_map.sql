-- ============================================================================
-- MIGRATION: 20261020_valant_provider_map.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Valant provider code -> staff user mapping (src/lib/migration/valantProviderMap.ts)
--   * One row per (organization, provider code) as exported by Valant ("K.Daniel", "Daniel K").
--     "codeKey" is the trimmed, space-collapsed, lowercased code (the lookup key).
--   * Set only by a person in Admin > Data import > Valant provider codes (audited). Codes
--     are never matched to staff by name; an unmapped code stays unmapped.
--   * Read by the primary care PCP check (src/lib/medical/pcpAssignment.ts) and by Billing >
--     Provider Collections (a mapped code wins over the import's name match).
--   * Plain id columns (no foreign keys), like the other Valant reference tables.
-- Apply BEFORE deploying the code that reads this table.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ValantProviderMap" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "providerCode"   TEXT NOT NULL,
  "codeKey"        TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "mappedById"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantProviderMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ValantProviderMap_organizationId_codeKey_key"
  ON "ValantProviderMap" ("organizationId", "codeKey");

CREATE INDEX IF NOT EXISTS "ValantProviderMap_organizationId_userId_idx"
  ON "ValantProviderMap" ("organizationId", "userId");
