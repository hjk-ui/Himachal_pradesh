-- Oct 24 diagnosis list (rows are never deleted; code immutable after add)
DO $$ BEGIN
  CREATE TYPE "ClientDiagnosisStatus" AS ENUM ('ACTIVE', 'PROVISIONAL', 'RULED_OUT', 'RESOLVED', 'ENTERED_IN_ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ClientDiagnosis" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "dsm5Name" TEXT,
  "status" "ClientDiagnosisStatus" NOT NULL DEFAULT 'ACTIVE',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "onsetDate" TIMESTAMP(3),
  "resolvedDate" TIMESTAMP(3),
  "needsCoding" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  CONSTRAINT "ClientDiagnosis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClientDiagnosisEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "diagnosisId" TEXT,
  "action" TEXT NOT NULL,
  "code" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "detail" JSONB,
  "actorId" TEXT,
  "actorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientDiagnosisEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientDiagnosis_organizationId_clientId_status_idx" ON "ClientDiagnosis"("organizationId", "clientId", "status");
CREATE INDEX IF NOT EXISTS "ClientDiagnosis_clientId_rank_idx" ON "ClientDiagnosis"("clientId", "rank");
CREATE INDEX IF NOT EXISTS "ClientDiagnosisEvent_organizationId_clientId_createdAt_idx" ON "ClientDiagnosisEvent"("organizationId", "clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientDiagnosisEvent_diagnosisId_idx" ON "ClientDiagnosisEvent"("diagnosisId");

-- Exactly one primary among ACTIVE|PROVISIONAL (at most one enforced here; the app guarantees at least one)
CREATE UNIQUE INDEX IF NOT EXISTS "ClientDiagnosis_one_primary_per_client"
  ON "ClientDiagnosis"("clientId")
  WHERE "isPrimary" = true AND "status" IN ('ACTIVE', 'PROVISIONAL');

-- A code appears once among current (ACTIVE|PROVISIONAL) diagnoses for a client
CREATE UNIQUE INDEX IF NOT EXISTS "ClientDiagnosis_current_code_per_client"
  ON "ClientDiagnosis"("clientId", "code")
  WHERE "status" IN ('ACTIVE', 'PROVISIONAL');

DO $$ BEGIN
  ALTER TABLE "ClientDiagnosis" ADD CONSTRAINT "ClientDiagnosis_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ClientDiagnosis" ADD CONSTRAINT "ClientDiagnosis_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ClientDiagnosisEvent" ADD CONSTRAINT "ClientDiagnosisEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ClientDiagnosisEvent" ADD CONSTRAINT "ClientDiagnosisEvent_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
