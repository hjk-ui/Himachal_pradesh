-- ============================================================================
-- MIGRATION: 20261018_lab_catalog.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Per-org lab test catalog (Valant "lab request types" import merged with the built-in
--   Altrixs catalog), standing / recurring lab orders, and the ordering → result → review →
--   portal-release workflow on LabOrder / LabResult. See docs/labs.md.
-- ADDS:
--   * enum value "LabVendor".'IN_HOUSE'
--   * table lab_tests            (per-org catalog; unique (organizationId, key))
--   * table lab_standing_orders  (recurring orders with nextDueAt)
--   * LabOrder columns: testLines, fastingRequired, collectionSite, billTo, abnRequired, abnNote,
--     standingOrderId, sentAt, performingLabName, resultDocumentId, hasCritical,
--     reviewedAt, reviewedById, reviewedByName, reviewNote, releasedAt, releasedById
--   * LabResult columns: testKey, panelName, loinc, numericValue, criticalRange, flagSource,
--     collectedAt, performingLab, enteredById, enteredByName
-- NOT TOUCHED: existing rows (all new columns are nullable or defaulted); no data is seeded,
--   so no code (LOINC / CPT) is written by this migration.
-- ============================================================================

-- Postgres 12+: ADD VALUE IF NOT EXISTS is allowed here; the new value is not used in this file.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LabVendor') THEN
    ALTER TYPE "LabVendor" ADD VALUE IF NOT EXISTS 'IN_HOUSE';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lab_tests (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "aliases"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isPanel"         BOOLEAN NOT NULL DEFAULT FALSE,
  "components"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "loinc"           TEXT,
  "cpt"             TEXT,
  "specimenType"    TEXT,
  "container"       TEXT,
  "fastingRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "specialHandling" TEXT,
  "category"        TEXT NOT NULL,
  "orderType"       TEXT NOT NULL DEFAULT 'lab',
  "active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "source"          TEXT NOT NULL DEFAULT 'altrixs',
  "sourceNames"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "importedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "lab_tests_organizationId_key_key" ON lab_tests ("organizationId", "key");
CREATE INDEX IF NOT EXISTS "lab_tests_organizationId_active_idx" ON lab_tests ("organizationId", "active");

CREATE TABLE IF NOT EXISTS lab_standing_orders (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "tests"          JSONB NOT NULL,
  "icd10Codes"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "intervalUnit"   TEXT NOT NULL,
  "intervalCount"  INTEGER NOT NULL,
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3),
  "nextDueAt"      TIMESTAMP(3) NOT NULL,
  "lastOrderedAt"  TIMESTAMP(3),
  "lastOrderId"    TEXT,
  "orderSetKey"    TEXT,
  "lab"            "LabVendor" NOT NULL DEFAULT 'QUEST',
  "note"           TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById"    TEXT NOT NULL,
  "createdByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "lab_standing_orders_organizationId_active_nextDueAt_idx" ON lab_standing_orders ("organizationId", "active", "nextDueAt");
CREATE INDEX IF NOT EXISTS "lab_standing_orders_clientId_idx" ON lab_standing_orders ("clientId");

DO $$
BEGIN
  IF to_regclass('public."LabOrder"') IS NOT NULL THEN
    ALTER TABLE "LabOrder"
      ADD COLUMN IF NOT EXISTS "testLines"         JSONB,
      ADD COLUMN IF NOT EXISTS "fastingRequired"   BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS "collectionSite"    TEXT,
      ADD COLUMN IF NOT EXISTS "billTo"            TEXT,
      ADD COLUMN IF NOT EXISTS "abnRequired"       BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS "abnNote"           TEXT,
      ADD COLUMN IF NOT EXISTS "standingOrderId"   TEXT,
      ADD COLUMN IF NOT EXISTS "sentAt"            TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "performingLabName" TEXT,
      ADD COLUMN IF NOT EXISTS "resultDocumentId"  TEXT,
      ADD COLUMN IF NOT EXISTS "hasCritical"       BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS "reviewedAt"        TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "reviewedById"      TEXT,
      ADD COLUMN IF NOT EXISTS "reviewedByName"    TEXT,
      ADD COLUMN IF NOT EXISTS "reviewNote"        TEXT,
      ADD COLUMN IF NOT EXISTS "releasedAt"        TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "releasedById"      TEXT;
    CREATE INDEX IF NOT EXISTS "LabOrder_organizationId_orderedById_reviewedAt_idx" ON "LabOrder" ("organizationId", "orderedById", "reviewedAt");
    -- Orders already marked critical keep that state as the flag the inbox reads
    UPDATE "LabOrder" SET "hasCritical" = TRUE WHERE "status" = 'critical' AND "hasCritical" = FALSE;
  END IF;

  IF to_regclass('public."LabResult"') IS NOT NULL THEN
    ALTER TABLE "LabResult"
      ADD COLUMN IF NOT EXISTS "testKey"       TEXT,
      ADD COLUMN IF NOT EXISTS "panelName"     TEXT,
      ADD COLUMN IF NOT EXISTS "loinc"         TEXT,
      ADD COLUMN IF NOT EXISTS "numericValue"  DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "criticalRange" TEXT,
      ADD COLUMN IF NOT EXISTS "flagSource"    TEXT,
      ADD COLUMN IF NOT EXISTS "collectedAt"   TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "performingLab" TEXT,
      ADD COLUMN IF NOT EXISTS "enteredById"   TEXT,
      ADD COLUMN IF NOT EXISTS "enteredByName" TEXT;
    CREATE INDEX IF NOT EXISTS "LabResult_testKey_idx" ON "LabResult" ("testKey");
  END IF;
END $$;
