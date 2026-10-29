-- ============================================================================
-- MIGRATION: 20261018_valant_payers.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Valant insurance companies (Admin › EHR Migration › Import Insurance Companies,
--        Billing › Insurance companies)
--   * "ValantPayer": one row per (organization, normalized name, Valant EDI payer ID ('' = none)).
--     Reference for billing. ediPayerId is Valant's clearinghouse ID and is NEVER copied into
--     waystar_payer_mappings. taxIdsRaw is Valant's internal tax-ID association list (often the
--     practice's own EIN): reference only, never shown as the payer's tax ID.
--   * "ValantPayerAddress": each distinct claim address (+ phones) of a payer (child table:
--     payers legitimately have several claim addresses, each with its own phone / tax-ID list).
--   * "PayerRegistry": created only if this database never had it (it is in schema.prisma; older
--     databases were created with `prisma db push`). Billing creates entries from a Valant payer
--     explicitly; nothing is written here.
--   Plain id columns to Organization (same pattern as MeasurementType); the address -> payer FK cascades.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ValantPayer" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "normalizedName"   TEXT NOT NULL,
  "ediPayerId"       TEXT NOT NULL DEFAULT '',
  "nameVariants"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "addressLine"      TEXT,
  "city"             TEXT,
  "state"            TEXT,
  "zip"              TEXT,
  "addressRaw"       TEXT,
  "phone"            TEXT,
  "phoneRaw"         TEXT,
  "phoneStatus"      TEXT NOT NULL DEFAULT 'missing',
  "taxIdsRaw"        TEXT,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "sourceRowHash"    TEXT NOT NULL,
  "sourceRowCount"   INTEGER NOT NULL DEFAULT 1,
  "duplicateGroup"   TEXT,
  "confirmedAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "payerRegistryId"  TEXT,
  "linkedById"       TEXT,
  "linkedAt"         TIMESTAMP(3),
  "importId"         TEXT,
  "importedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantPayer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ValantPayer_organizationId_normalizedName_ediPayerId_key"
  ON "ValantPayer" ("organizationId", "normalizedName", "ediPayerId");
CREATE INDEX IF NOT EXISTS "ValantPayer_organizationId_ediPayerId_idx"
  ON "ValantPayer" ("organizationId", "ediPayerId");
CREATE INDEX IF NOT EXISTS "ValantPayer_organizationId_payerRegistryId_idx"
  ON "ValantPayer" ("organizationId", "payerRegistryId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantPayer_phoneStatus_check') THEN
    ALTER TABLE "ValantPayer"
      ADD CONSTRAINT "ValantPayer_phoneStatus_check" CHECK ("phoneStatus" IN ('valid', 'invalid', 'missing'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ValantPayerAddress" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "payerId"        TEXT NOT NULL,
  "addressKey"     TEXT NOT NULL,
  "addressLine"    TEXT,
  "city"           TEXT,
  "state"          TEXT,
  "zip"            TEXT,
  "addressRaw"     TEXT,
  "addressStatus"  TEXT NOT NULL DEFAULT 'ok',
  "addressIssues"  TEXT[] DEFAULT ARRAY[]::TEXT[],
  "phone"          TEXT,
  "phonesRaw"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "phoneStatus"    TEXT NOT NULL DEFAULT 'missing',
  "phoneIssues"    TEXT[] DEFAULT ARRAY[]::TEXT[],
  "taxIdsRaw"      TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceLines"    INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "position"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ValantPayerAddress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ValantPayerAddress_payerId_addressKey_key"
  ON "ValantPayerAddress" ("payerId", "addressKey");
CREATE INDEX IF NOT EXISTS "ValantPayerAddress_organizationId_idx"
  ON "ValantPayerAddress" ("organizationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantPayerAddress_payerId_fkey') THEN
    ALTER TABLE "ValantPayerAddress"
      ADD CONSTRAINT "ValantPayerAddress_payerId_fkey"
      FOREIGN KEY ("payerId") REFERENCES "ValantPayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantPayerAddress_addressStatus_check') THEN
    ALTER TABLE "ValantPayerAddress"
      ADD CONSTRAINT "ValantPayerAddress_addressStatus_check" CHECK ("addressStatus" IN ('ok', 'suspect', 'unparsed', 'missing'));
  END IF;
END $$;

-- PayerRegistry (schema.prisma model) for databases that never had it. No-op where it exists.
CREATE TABLE IF NOT EXISTS "PayerRegistry" (
  "id"                  TEXT NOT NULL,
  "organizationId"      TEXT NOT NULL,
  "payerId"             TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "clearinghouse"       TEXT NOT NULL DEFAULT 'Availity',
  "claimsAddress"       TEXT,
  "phone"               TEXT,
  "portalUrl"           TEXT,
  "timelyFilingDays"    INTEGER NOT NULL DEFAULT 90,
  "eraEnrollmentStatus" TEXT NOT NULL DEFAULT 'Active',
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayerRegistry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayerRegistry_organizationId_payerId_key" ON "PayerRegistry" ("organizationId", "payerId");
CREATE INDEX IF NOT EXISTS "PayerRegistry_organizationId_active_idx" ON "PayerRegistry" ("organizationId", "active");
