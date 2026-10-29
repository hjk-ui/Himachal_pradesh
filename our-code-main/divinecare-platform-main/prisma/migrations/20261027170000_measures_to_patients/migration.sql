-- Measures to patients (Oct 24): MeasureAssignment + MeasureRequest.
-- Raw tokens are never stored; MeasureRequest.tokenHash is sha256 hex only.
-- MBC practice options live in ClinicModuleState module "practice:mbc-options" (no columns needed).

CREATE TABLE IF NOT EXISTS "MeasureAssignment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "instrumentKey" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "nextDueAt" TIMESTAMP(3),
  "itemContentPending" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeasureAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MeasureRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "instrumentKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dobAttempts" INTEGER NOT NULL DEFAULT 0,
  "answers" JSONB,
  "completedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeasureRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MeasureRequest_tokenHash_key" ON "MeasureRequest"("tokenHash");
CREATE INDEX IF NOT EXISTS "MeasureAssignment_organizationId_clientId_idx" ON "MeasureAssignment"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "MeasureAssignment_organizationId_status_nextDueAt_idx" ON "MeasureAssignment"("organizationId", "status", "nextDueAt");
CREATE INDEX IF NOT EXISTS "MeasureRequest_organizationId_clientId_createdAt_idx" ON "MeasureRequest"("organizationId", "clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "MeasureRequest_organizationId_status_idx" ON "MeasureRequest"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "MeasureRequest_assignmentId_idx" ON "MeasureRequest"("assignmentId");

DO $$ BEGIN
  ALTER TABLE "MeasureAssignment" ADD CONSTRAINT "MeasureAssignment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MeasureAssignment" ADD CONSTRAINT "MeasureAssignment_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MeasureRequest" ADD CONSTRAINT "MeasureRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MeasureRequest" ADD CONSTRAINT "MeasureRequest_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MeasureRequest" ADD CONSTRAINT "MeasureRequest_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "MeasureAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
