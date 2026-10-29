-- ============================================================================
-- MIGRATION: 20261027_payer_master.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No payer data is written.
-- WHY: Billing › Payers becomes the editable payer master (src/lib/billing/payerMaster.ts) and
--      Billing › Insurance Panels moves from a JSON module list to its own table.
--   * "PayerRegistry": structured claims mailing address, payer type, fax, ERA / EFT enrollment,
--     notes, updatedById. payerId may be blank until staff confirm it on Waystar's payer list
--     (shown as "Missing"). The invented defaults are removed: timelyFilingDays had DEFAULT 90,
--     eraEnrollmentStatus DEFAULT 'Active' and clearinghouse DEFAULT 'Availity'. Existing values
--     are left as they are (staging had 0 rows).
--   * "PayerPanel": one credentialing / contract panel per payer (providers, status, dates, payer-
--     assigned provider ID / PIN, open to new clients, contact). Rows from the old 'payer-panels'
--     ClinicModuleState list are imported from the page by staff (legacyId dedupe), not here.
-- NOTE: PayerRegistry is read without `select` in a few routes, so those fail until this runs
--       (the deploy runs migrations first).
-- ============================================================================

ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "payerType" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "claimsAddressLine1" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "claimsAddressLine2" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "claimsCity" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "claimsState" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "claimsZip" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "fax" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "eftEnrollmentStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "PayerRegistry" ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

ALTER TABLE "PayerRegistry" ALTER COLUMN "payerId" DROP NOT NULL;
ALTER TABLE "PayerRegistry" ALTER COLUMN "timelyFilingDays" DROP NOT NULL;
ALTER TABLE "PayerRegistry" ALTER COLUMN "timelyFilingDays" DROP DEFAULT;
ALTER TABLE "PayerRegistry" ALTER COLUMN "eraEnrollmentStatus" SET DEFAULT 'unknown';
ALTER TABLE "PayerRegistry" ALTER COLUMN "clearinghouse" SET DEFAULT 'Waystar';

CREATE TABLE IF NOT EXISTS "PayerPanel" (
  "id"                     TEXT NOT NULL,
  "organizationId"         TEXT NOT NULL,
  "payerRegistryId"        TEXT,
  "payerName"              TEXT NOT NULL,
  "providerUserIds"        TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status"                 TEXT NOT NULL DEFAULT 'not_started',
  "submittedDate"          DATE,
  "effectiveDate"          DATE,
  "recredentialingDueDate" DATE,
  "providerPin"            TEXT,
  "openToNewClients"       BOOLEAN NOT NULL DEFAULT false,
  "contactName"            TEXT,
  "contactPhone"           TEXT,
  "contactEmail"           TEXT,
  "notes"                  TEXT,
  "legacyId"               TEXT,
  "createdById"            TEXT,
  "updatedById"            TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayerPanel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayerPanel_organizationId_legacyId_key" ON "PayerPanel" ("organizationId", "legacyId");
CREATE INDEX IF NOT EXISTS "PayerPanel_organizationId_status_idx" ON "PayerPanel" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "PayerPanel_organizationId_payerRegistryId_idx" ON "PayerPanel" ("organizationId", "payerRegistryId");
