-- ============================================================================
-- MIGRATION: 20261018_measurement_types.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: measurement types catalog + recorded measures
--   * "MeasurementType": the practice's catalog of measures (Valant "Measurement Types"
--     export via Admin › Data import › Import Measurement Types). Definitions only, no PHI.
--     documentationCode / defaultUnits use '' for none so the unique key holds.
--   * "MeasurementResult": one recorded value per client per measure ("Record a measure" in
--     the chart's Assessments & outcomes tab; a later Valant results import uses sourceRef).
--   Plain id columns to Organization / Client, no foreign keys (same pattern as
--   FacilityLocationMap); MeasurementResult -> MeasurementType has a FK (RESTRICT).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "MeasurementType" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "documentationCode" TEXT NOT NULL DEFAULT '',
  "category"          TEXT NOT NULL DEFAULT 'other',
  "dataType"          TEXT NOT NULL,
  "defaultUnits"      TEXT NOT NULL DEFAULT '',
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "source"            TEXT NOT NULL DEFAULT 'valant',
  "sourceName"        TEXT,
  "sourceCategory"    TEXT,
  "sourceDataType"    TEXT,
  "sourceUnits"       TEXT,
  "instrumentKey"     TEXT,
  "parentInstrument"  TEXT,
  "isSubscore"        BOOLEAN NOT NULL DEFAULT false,
  "vitalField"        TEXT,
  "importedAt"        TIMESTAMP(3),
  "updatedById"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeasurementType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MeasurementType_organizationId_name_documentationCode_dataType_defaultUnits_key"
  ON "MeasurementType" ("organizationId", "name", "documentationCode", "dataType", "defaultUnits");
CREATE INDEX IF NOT EXISTS "MeasurementType_organizationId_active_idx"
  ON "MeasurementType" ("organizationId", "active");
CREATE INDEX IF NOT EXISTS "MeasurementType_organizationId_parentInstrument_idx"
  ON "MeasurementType" ("organizationId", "parentInstrument");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeasurementType_dataType_check') THEN
    ALTER TABLE "MeasurementType"
      ADD CONSTRAINT "MeasurementType_dataType_check"
      CHECK ("dataType" IN ('integer', 'real', 'blood_pressure', 'bmi', 'length', 'mass', 'smoking_status'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MeasurementResult" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "measurementTypeId" TEXT NOT NULL,
  "valueNumeric"      DOUBLE PRECISION,
  "valueSecondary"    DOUBLE PRECISION,
  "valueText"         TEXT,
  "units"             TEXT,
  "measuredAt"        TIMESTAMP(3) NOT NULL,
  "source"            TEXT NOT NULL DEFAULT 'manual',
  "sourceRef"         TEXT,
  "notes"             TEXT,
  "recordedById"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeasurementResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MeasurementResult_organizationId_source_sourceRef_key"
  ON "MeasurementResult" ("organizationId", "source", "sourceRef");
CREATE INDEX IF NOT EXISTS "MeasurementResult_organizationId_clientId_measuredAt_idx"
  ON "MeasurementResult" ("organizationId", "clientId", "measuredAt");
CREATE INDEX IF NOT EXISTS "MeasurementResult_organizationId_measurementTypeId_idx"
  ON "MeasurementResult" ("organizationId", "measurementTypeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MeasurementResult_measurementTypeId_fkey') THEN
    ALTER TABLE "MeasurementResult"
      ADD CONSTRAINT "MeasurementResult_measurementTypeId_fkey"
      FOREIGN KEY ("measurementTypeId") REFERENCES "MeasurementType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
