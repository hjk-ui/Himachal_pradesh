-- ============================================================================
-- MIGRATION: 20261019_runtime_ddl_to_migration.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Two stores created their tables at request time with CREATE/ALTER statements
--   (src/lib/notes/workflow-store.ts ensureWorkflowTable, src/lib/ai/noteQuality/reviewStore.ts
--   ensureTable). The app's database user should not need DDL rights, and the schema should
--   change only through migrations. This file holds exactly what the runtime created; the
--   runtime DDL is removed in the same change.
-- ADDS (all IF NOT EXISTS; on staging every object already exists, so this is a no-op there):
--   * enum "ProgressNoteWorkflowStatus" (DRAFT, SIGNED, LOCKED) when missing (fresh databases;
--     the runtime assumed it from prisma/schema.prisma)
--   * table "ProgressNoteWorkflow" + 3 indexes + signature / co-sign / planPendingUntil columns
--     (the columns are also in 20261016_notes_metadata_addenda_cosign_phrases and
--     20261018_plan_pending_transition)
--   * table "NoteQualityReview" + index ("noteId", "createdAt")
-- NOT TOUCHED: existing rows.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProgressNoteWorkflowStatus') THEN
    CREATE TYPE "ProgressNoteWorkflowStatus" AS ENUM ('DRAFT', 'SIGNED', 'LOCKED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ProgressNoteWorkflow" (
  "noteId" TEXT NOT NULL,
  "status" "ProgressNoteWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "signedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "clientId" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "clientImage" TEXT,
  "clinicianId" TEXT,
  "clinicianName" TEXT,
  "clinicianImage" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressNoteWorkflow_pkey" PRIMARY KEY ("noteId")
);

CREATE INDEX IF NOT EXISTS "ProgressNoteWorkflow_status_lockedAt_idx"
  ON "ProgressNoteWorkflow" ("status", "lockedAt");

CREATE INDEX IF NOT EXISTS "ProgressNoteWorkflow_clientId_lockedAt_idx"
  ON "ProgressNoteWorkflow" ("clientId", "lockedAt");

CREATE INDEX IF NOT EXISTS "ProgressNoteWorkflow_clinicianId_lockedAt_idx"
  ON "ProgressNoteWorkflow" ("clinicianId", "lockedAt");

ALTER TABLE "ProgressNoteWorkflow"
  ADD COLUMN IF NOT EXISTS "signedById" TEXT,
  ADD COLUMN IF NOT EXISTS "signedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "attestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cosignRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cosignedById" TEXT,
  ADD COLUMN IF NOT EXISTS "cosignedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "cosignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supervisorComment" TEXT;

ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "planPendingUntil" DATE;

CREATE TABLE IF NOT EXISTS "NoteQualityReview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "reviewerName" TEXT,
  "action" TEXT NOT NULL,
  "comment" TEXT,
  "findings" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoteQualityReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NoteQualityReview_noteId_createdAt_idx"
  ON "NoteQualityReview" ("noteId", "createdAt");
