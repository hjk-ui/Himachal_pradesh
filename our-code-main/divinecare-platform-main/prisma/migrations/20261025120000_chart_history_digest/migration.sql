-- Oct 25 chart history digest (bh | medical)
CREATE TABLE IF NOT EXISTS "ClientChartDigest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bh',
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientChartDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientChartDigest_organizationId_clientId_kind_key"
  ON "ClientChartDigest"("organizationId", "clientId", "kind");

CREATE INDEX IF NOT EXISTS "ClientChartDigest_organizationId_clientId_idx"
  ON "ClientChartDigest"("organizationId", "clientId");

ALTER TABLE "ClientChartDigest"
  ADD CONSTRAINT "ClientChartDigest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientChartDigest"
  ADD CONSTRAINT "ClientChartDigest_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
