-- Smart Document Intake uploads: org ownership, file metadata, OCR and match state.
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "uploadedById" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "ocrJobId" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "pageCount" INTEGER;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "extractedText" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "matchStatus" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "matchReason" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "matchCandidates" JSONB;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "processingError" TEXT;
CREATE INDEX IF NOT EXISTS "DocumentIntake_organizationId_status_idx" ON "DocumentIntake" ("organizationId", "status");

-- HIPAA audit trail (append-only, 6-year retention).
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "actorUserId" TEXT,
  "actorRole" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "patientId" TEXT,
  "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retainUntil" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx" ON "AuditLog" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_patientId_createdAt_idx" ON "AuditLog" ("patientId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_createdAt_idx" ON "AuditLog" ("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt");

-- Entries can be added, never changed or removed by the application.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_update_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Primary insurance detail and second phone from the Valant patient export.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "insuranceType" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "insuranceCoverageType" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "insurancePayerPhone" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "insuranceEffectiveFrom" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "insuranceEffectiveTo" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "copayAmount" DECIMAL(10,2);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "phoneSecondary" TEXT;
