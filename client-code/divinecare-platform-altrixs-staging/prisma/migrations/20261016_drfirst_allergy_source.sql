-- DrFirst Rcopia allergy download (update_allergy): mark downloaded chart allergies
-- and keep Rcopia's allergy id for upserts. Local rows keep source NULL.
-- patientId becomes optional: Rcopia allergies for a behavioral-health client
-- without a medical chart are stored by clientId only. Idempotent.
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "MedicalAllergy" ADD COLUMN IF NOT EXISTS "rcopiaAllergyId" TEXT;
ALTER TABLE "MedicalAllergy" ALTER COLUMN "patientId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "MedicalAllergy_clientId_rcopiaAllergyId_idx" ON "MedicalAllergy" ("clientId", "rcopiaAllergyId");
