-- HealthLake FHIR R4 sync outbox + run log (FhirSyncState, FhirSyncRun).
-- Hashes, ids and status only; no resource content is stored. Idempotent.
CREATE TABLE IF NOT EXISTS "FhirSyncState" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "resourceType"   TEXT NOT NULL,
  "resourceId"     TEXT NOT NULL,
  "sourceTable"    TEXT NOT NULL,
  "sourceId"       TEXT NOT NULL,
  "clientId"       TEXT,
  "operation"      TEXT NOT NULL DEFAULT 'UPSERT',
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "hash"           TEXT NOT NULL,
  "syncedHash"     TEXT,
  "versionId"      TEXT,
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3),
  "lastError"      TEXT,
  "lastSyncedAt"   TIMESTAMP(3),
  "importJobId"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FhirSyncState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FhirSyncState_resourceType_resourceId_key" ON "FhirSyncState" ("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "FhirSyncState_organizationId_status_idx" ON "FhirSyncState" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "FhirSyncState_organizationId_resourceType_idx" ON "FhirSyncState" ("organizationId", "resourceType");
CREATE INDEX IF NOT EXISTS "FhirSyncState_status_nextAttemptAt_idx" ON "FhirSyncState" ("status", "nextAttemptAt");

CREATE TABLE IF NOT EXISTS "FhirSyncRun" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "trigger"        TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  "scanned"        INTEGER NOT NULL DEFAULT 0,
  "queued"         INTEGER NOT NULL DEFAULT 0,
  "synced"         INTEGER NOT NULL DEFAULT 0,
  "deleted"        INTEGER NOT NULL DEFAULT 0,
  "failed"         INTEGER NOT NULL DEFAULT 0,
  "excluded"       INTEGER NOT NULL DEFAULT 0,
  "detailJson"     JSONB,
  "error"          TEXT,
  CONSTRAINT "FhirSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FhirSyncRun_organizationId_startedAt_idx" ON "FhirSyncRun" ("organizationId", "startedAt");
