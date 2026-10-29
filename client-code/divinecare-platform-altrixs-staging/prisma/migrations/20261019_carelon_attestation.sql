-- ============================================================================
-- MIGRATION: 20261019_carelon_attestation.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Carelon Behavioral Health - Maryland "Attestation to Discharge Conflicting/Overlapping
--   Authorization(s) Due to Non-Overlap Requirement" for every Maryland Medicaid client
--   (Carelon is the PBHS ASO). Reuses the existing ConsentForm table: a structured, versioned
--   form row carries its template key / version, workflow status, the frozen signed document
--   (exact text + prefilled values), Part A / Part B signatures, the Carelon portal submission
--   date (recorded by staff; Altrixs does not transmit) and the stored signed PDF.
-- ADDS (all nullable; existing consent rows are untouched and stay NULL):
--   ConsentForm."formKey", "formVersion", "formStatus", "formData" JSONB, "neededReason",
--   "clientSignedAt", "providerSignedAt", "providerSignedById", "submittedAt", "submittedById",
--   "supersededAt", "supersededById", "pdfFileName", "pdfSha256"
--   + indexes (organizationId, formKey, formStatus) and (clientId, formKey)
-- CODE: src/lib/consents/carelon/*, /api/consents/carelon/*, /dashboard/ehr/consents/carelon
-- ============================================================================

ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "formKey" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "formVersion" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "formStatus" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "formData" JSONB;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "neededReason" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "clientSignedAt" TIMESTAMP(3);
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "providerSignedAt" TIMESTAMP(3);
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "providerSignedById" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "submittedById" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "supersededById" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "pdfFileName" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "pdfSha256" TEXT;

CREATE INDEX IF NOT EXISTS "ConsentForm_organizationId_formKey_formStatus_idx"
  ON "ConsentForm" ("organizationId", "formKey", "formStatus");
CREATE INDEX IF NOT EXISTS "ConsentForm_clientId_formKey_idx"
  ON "ConsentForm" ("clientId", "formKey");
