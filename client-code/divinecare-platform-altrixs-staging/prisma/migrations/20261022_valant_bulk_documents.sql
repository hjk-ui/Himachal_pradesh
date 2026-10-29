-- ============================================================================
-- MIGRATION: 20261022_valant_bulk_documents.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: Valant documents ZIP import (one folder per client, PDFs of notes, consents, receipts, ...).
--   * DocumentIntake: archive path, sha256 (re-running an import never duplicates a document),
--     import batch, read-only flag for imported records, and leadership void (who / when / why).
--   * ValantDocImportBatch: one row per uploaded ZIP; dry-run then apply, progress cursor,
--     counts and a report with counts and masked folder labels only.
-- See src/lib/migration/valantDocuments.ts and src/lib/migration/valantDocumentsJob.ts.
-- ============================================================================

ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "sourcePath" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "sha256" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "readOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "voidedById" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

CREATE INDEX IF NOT EXISTS "DocumentIntake_organizationId_sha256_idx" ON "DocumentIntake"("organizationId", "sha256");
CREATE INDEX IF NOT EXISTS "DocumentIntake_importBatchId_idx" ON "DocumentIntake"("importBatchId");

CREATE TABLE IF NOT EXISTS "ValantDocImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "sourceKind" TEXT NOT NULL,
    "sourceBucket" TEXT,
    "sourceKey" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" BIGINT,
    "uploadId" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "ocrForSearch" BOOLEAN NOT NULL DEFAULT false,
    "phase" TEXT,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedById" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "dryRunAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ValantDocImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ValantDocImportBatch_organizationId_createdAt_idx" ON "ValantDocImportBatch"("organizationId", "createdAt");
