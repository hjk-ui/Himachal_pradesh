-- ============================================================================
-- MIGRATION: 20261025_diagnosis_list.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Diagnosis review (owner request "reevaluate the diagnosis"). One source of truth for a
--   client's diagnosis list (src/lib/diagnoses/standard.ts):
--   * ClientDiagnosis: one row per diagnosis (ICD-10-CM code, description, DSM-5-TR name, rank,
--     status active / provisional / ruled out / resolved / entered in error, onset and resolved
--     dates, diagnosing provider, source). Rows are never deleted: they are resolved or marked
--     entered in error. Exactly one primary per client (partial unique index below).
--     Client.primaryDiagnosis / primaryDiagnosisCode / secondaryDiagnoses stay as a derived copy
--     so existing readers (DrFirst push, AI context, banners) keep working.
--   * ClientDiagnosisEvent: full history (add, change, rank, status, review "no change").
--   * ClientDiagnosisSuggestion: AI scribe / coding suggestions waiting for a clinician to accept
--     or dismiss (suggestions are never added to the list on their own).
--   * NotePolicySettings.diagnosisReviewDays: how often the list should be re-reviewed (default 90).
-- Backfill of existing client-record diagnoses: scripts/backfill-diagnoses.ts (dry run by default).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ClientDiagnosis" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT NOT NULL,
  "dsmName" TEXT,
  "rank" INTEGER NOT NULL DEFAULT 1,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "onsetDate" DATE,
  "resolvedDate" DATE,
  "statusReason" TEXT,
  "diagnosingProviderId" TEXT,
  "diagnosingProviderName" TEXT,
  "source" TEXT NOT NULL DEFAULT 'CLINICIAN',
  "sourceRef" TEXT,
  "codeSetYear" INTEGER,
  "comment" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientDiagnosis_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientDiagnosis_clientId_status_idx" ON "ClientDiagnosis"("clientId", "status");
CREATE INDEX IF NOT EXISTS "ClientDiagnosis_organizationId_status_idx" ON "ClientDiagnosis"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "ClientDiagnosis_clientId_code_idx" ON "ClientDiagnosis"("clientId", "code");
-- Exactly one primary per client
CREATE UNIQUE INDEX IF NOT EXISTS "ClientDiagnosis_one_primary_per_client" ON "ClientDiagnosis"("clientId") WHERE "isPrimary" = true;
-- A code is listed once while it is current (resolved / ruled-out history may repeat it)
CREATE UNIQUE INDEX IF NOT EXISTS "ClientDiagnosis_current_code_per_client" ON "ClientDiagnosis"("clientId", "code")
  WHERE "code" IS NOT NULL AND "status" IN ('ACTIVE', 'PROVISIONAL');

CREATE TABLE IF NOT EXISTS "ClientDiagnosisEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "diagnosisId" TEXT,
  "action" TEXT NOT NULL,
  "context" TEXT,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT,
  "actorId" TEXT,
  "actorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientDiagnosisEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientDiagnosisEvent_clientId_createdAt_idx" ON "ClientDiagnosisEvent"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "ClientDiagnosisEvent_clientId_action_idx" ON "ClientDiagnosisEvent"("clientId", "action");
CREATE INDEX IF NOT EXISTS "ClientDiagnosisEvent_diagnosisId_idx" ON "ClientDiagnosisEvent"("diagnosisId");

CREATE TABLE IF NOT EXISTS "ClientDiagnosisSuggestion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "originRef" TEXT,
  "rationale" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdById" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientDiagnosisSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClientDiagnosisSuggestion_clientId_status_idx" ON "ClientDiagnosisSuggestion"("clientId", "status");

ALTER TABLE "NotePolicySettings" ADD COLUMN IF NOT EXISTS "diagnosisReviewDays" INTEGER NOT NULL DEFAULT 90;
