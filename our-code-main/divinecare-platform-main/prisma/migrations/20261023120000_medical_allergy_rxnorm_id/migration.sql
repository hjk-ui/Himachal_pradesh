-- Additive only. Request-time code may already have created this column.
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "rxnormId" TEXT;
