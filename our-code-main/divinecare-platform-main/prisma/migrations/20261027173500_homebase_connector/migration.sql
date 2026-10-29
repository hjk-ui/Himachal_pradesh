-- Oct 24 Homebase connector (read-only). Minimal id maps only — no wages, SSNs or phone numbers.
CREATE TABLE IF NOT EXISTS "HomebaseSyncRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "locationCount" INTEGER NOT NULL DEFAULT 0,
  "employeeCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "HomebaseSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HomebaseEmployeeLink" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "homebaseEmployeeId" TEXT NOT NULL,
  "homebaseLocationId" TEXT,
  "displayName" TEXT,
  "userId" TEXT,
  "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
  "matchedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomebaseEmployeeLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HomebaseSyncRun_organizationId_startedAt_idx" ON "HomebaseSyncRun"("organizationId", "startedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "HomebaseEmployeeLink_organizationId_homebaseEmployeeId_key" ON "HomebaseEmployeeLink"("organizationId", "homebaseEmployeeId");
CREATE INDEX IF NOT EXISTS "HomebaseEmployeeLink_organizationId_matchStatus_idx" ON "HomebaseEmployeeLink"("organizationId", "matchStatus");
CREATE INDEX IF NOT EXISTS "HomebaseEmployeeLink_userId_idx" ON "HomebaseEmployeeLink"("userId");

DO $$ BEGIN
  ALTER TABLE "HomebaseSyncRun" ADD CONSTRAINT "HomebaseSyncRun_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "HomebaseEmployeeLink" ADD CONSTRAINT "HomebaseEmployeeLink_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
