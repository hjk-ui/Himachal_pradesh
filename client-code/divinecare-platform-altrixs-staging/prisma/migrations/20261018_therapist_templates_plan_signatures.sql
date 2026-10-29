-- Therapist templates: treatment plan signatures (clinician, supervisor for pre-licensed authors,
-- patient via the portal) and staff license level. Additive and idempotent.

ALTER TABLE "TreatmentPlan"
  ADD COLUMN IF NOT EXISTS "planKind" TEXT NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN IF NOT EXISTS "supersedesId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceNoteId" TEXT,
  ADD COLUMN IF NOT EXISTS "signedSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "clinicianSignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clinicianSignedById" TEXT,
  ADD COLUMN IF NOT EXISTS "clinicianSignedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "supervisorRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supervisorSignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supervisorSignedById" TEXT,
  ADD COLUMN IF NOT EXISTS "supervisorSignedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "supervisorComment" TEXT,
  ADD COLUMN IF NOT EXISTS "patientSignatureStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN IF NOT EXISTS "patientSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "patientSignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "patientSignedName" TEXT,
  ADD COLUMN IF NOT EXISTS "patientDeclinedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "patientDeclineReason" TEXT,
  ADD COLUMN IF NOT EXISTS "patientVerbalBy" TEXT;

CREATE INDEX IF NOT EXISTS "TreatmentPlan_clientId_patientSignatureStatus_idx"
  ON "TreatmentPlan" ("clientId", "patientSignatureStatus");

-- LICENSED | PRE_LICENSED (null = derived from credentials / supervision track)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "licenseLevel" TEXT;
