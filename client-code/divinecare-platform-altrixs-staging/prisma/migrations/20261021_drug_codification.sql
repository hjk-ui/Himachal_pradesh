-- ============================================================================
-- MIGRATION: 20261021_drug_codification.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- SCOPE: Drug codification for DrFirst certification (docs/drfirst-certification/README.md)
--   AUM2 / AUM3 / AUR1 (drug allergies) and MUM2 / MUM3 / MUM4 / MUR1 (medications):
--   RxNorm codes from the NLM RxNav API (updated monthly), chosen at entry with the drug
--   typeahead or applied by scripts/codify-meds-allergies.ts.
--   * ClientMedication  rxnormTty, rxnormName, doseForm, strength, ndcCodes, drugCodedAt, drugCodeVersion
--                       (rxnormId, ndcCode, brandName, genericName already exist)
--   * MedicalAllergy    allergenType ('drug' | 'food' | 'environmental'; NULL = not classified)
--                       + the same drug-code columns
--   * ehr_prescriptions the same drug-code columns (snake_case)
-- Nothing is backfilled here: existing rows stay NULL ("not coded") until staff or the
-- backfill script codes them. Apply BEFORE deploying the code that reads these columns.
-- ============================================================================

ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "rxnormTty" TEXT;
ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "rxnormName" TEXT;
ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "doseForm" TEXT;
ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "strength" TEXT;
ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "ndcCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "drugCodedAt" TIMESTAMP(3);
ALTER TABLE "ClientMedication" ADD COLUMN IF NOT EXISTS "drugCodeVersion" TEXT;

ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "allergenType" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "rxnormId" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "rxnormTty" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "rxnormName" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "genericName" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "brandName" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "doseForm" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "strength" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "ndcCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "drugCodedAt" TIMESTAMP(3);
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "drugCodeVersion" TEXT;

ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "rxnorm_id" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "rxnorm_tty" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "rxnorm_name" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "generic_name" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "brand_name" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "dose_form" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "strength" TEXT;
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "ndc_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "drug_coded_at" TIMESTAMP(3);
ALTER TABLE "ehr_prescriptions" ADD COLUMN IF NOT EXISTS "drug_code_version" TEXT;

-- The DrFirst panel's readiness count and the backfill look for uncoded rows per client
CREATE INDEX IF NOT EXISTS "ClientMedication_clientId_rxnormId_idx" ON "ClientMedication" ("clientId", "rxnormId");
CREATE INDEX IF NOT EXISTS "MedicalAllergy_clientId_rxnormId_idx" ON "MedicalAllergy" ("clientId", "rxnormId");
