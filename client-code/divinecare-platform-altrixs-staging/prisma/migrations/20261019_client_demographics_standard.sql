-- ============================================================================
-- MIGRATION: 20261019_client_demographics_standard.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Structured client demographics for DrFirst Rcopia, Waystar X12 (837P / 270 / 276),
--   FHIR US Core Patient / USCDI v3, CRISP and Maryland Medicaid.
--   Code sets and the readiness checks live in src/lib/clients/demographics.ts.
--   * Name: legalMiddleName; needsNameReview + nameReviewReason (legal name not split
--     deterministically; staff confirm). Legal first / last / middle initial / suffix already exist.
--   * Sex and gender: administrativeSex (F/M/U, X12 DMG03 + Rcopia Sex), sexAtBirth (US Core
--     birthsex F/M/ASKU/UNK), genderIdentity + sexualOrientation (SNOMED CT or ASKU/UNK/OTH),
--     pronouns (LOINC LL5144-2 answers). Client."gender" stays as the legacy free-text value.
--   * race TEXT[] (OMB categories, CDC codes, multi-select), ethnicity.
--   * preferredLanguage (ISO 639) + interpreterNeeded; maritalStatus (HL7 v3).
--   * county; phoneType / phoneSecondaryType (mobile | home | work); ZIP+4 stays in "postalCode".
--   * emergencyContactRelationship; guardian*; guarantor* (responsible party).
--   * medicaidId (Maryland MA number); deceasedAt.
--   * NO BACKFILL here: scripts/backfill-client-legal-names.ts (dry run by default) fills the
--     legal name pieces and administrativeSex only from deterministic sources and flags the rest.
-- ============================================================================

ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "legalMiddleName" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "needsNameReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "nameReviewReason" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "administrativeSex" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "sexAtBirth" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "genderIdentity" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "sexualOrientation" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "pronouns" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "race" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "ethnicity" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "interpreterNeeded" BOOLEAN;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "maritalStatus" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "county" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "phoneType" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "phoneSecondaryType" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "emergencyContactRelationship" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guardianName" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guardianRelationship" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guardianPhone" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorFirstName" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorLastName" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorRelationship" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorDateOfBirth" DATE;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorPhone" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorAddressLine1" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorAddressLine2" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorCity" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorState" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "guarantorPostalCode" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "medicaidId" TEXT;
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "deceasedAt" TIMESTAMP(3);

-- Staff worklist: charts whose legal name needs review
CREATE INDEX IF NOT EXISTS "Client_needsNameReview_idx" ON "Client" ("organizationId") WHERE "needsNameReview" = true;
