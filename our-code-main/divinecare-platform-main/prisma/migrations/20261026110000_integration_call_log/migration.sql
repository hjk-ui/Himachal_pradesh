CREATE TABLE IF NOT EXISTS "IntegrationCallLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "integration" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "httpStatus" INTEGER,
  "durationMs" INTEGER,
  "userId" TEXT,
  "clientId" TEXT,
  "mrnMasked" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationCallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IntegrationCallLog_organizationId_createdAt_idx" ON "IntegrationCallLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "IntegrationCallLog_organizationId_integration_createdAt_idx" ON "IntegrationCallLog"("organizationId", "integration", "createdAt");
CREATE INDEX IF NOT EXISTS "IntegrationCallLog_organizationId_status_createdAt_idx" ON "IntegrationCallLog"("organizationId", "status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "IntegrationCallLog" ADD CONSTRAINT "IntegrationCallLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
