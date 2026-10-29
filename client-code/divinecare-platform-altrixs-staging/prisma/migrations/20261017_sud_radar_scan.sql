-- SUD Referral Radar automated scan: dedupe fingerprint, structured evidence, routing and review status.
-- Idempotent; existing hand-saved signals keep fingerprint NULL and are never resolved by the scan.
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "substanceClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "evidence" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "evidenceKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "confidence" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "routedAction" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "priority" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "needsScreening" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "statusReason" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3);
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "statusChangedById" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "referralAlertId" TEXT;
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "SudRadarSignal" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "SudRadarSignal_clientId_detectionSource_fingerprint_key"
  ON "SudRadarSignal"("clientId", "detectionSource", "fingerprint");
CREATE INDEX IF NOT EXISTS "SudRadarSignal_organizationId_status_idx"
  ON "SudRadarSignal"("organizationId", "status");
