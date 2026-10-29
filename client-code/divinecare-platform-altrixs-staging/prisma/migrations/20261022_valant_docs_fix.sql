-- ============================================================================
-- MIGRATION: 20261022_valant_docs_fix.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: Valant documents ZIP import, after the first staging run:
--   * DocumentIntake.valantDocumentId: the Valant document id from the export file name
--     "CODE_YYYYMMDD_Title(DocId).pdf", so the same Valant document is never imported twice for a
--     client (also across exports, e.g. "L - Z" and "Archived _ Inactive").
-- Requires 20261022_valant_bulk_documents.sql. See src/lib/migration/valantDocuments.ts.
-- ============================================================================

ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "valantDocumentId" TEXT;

CREATE INDEX IF NOT EXISTS "DocumentIntake_organizationId_valantDocumentId_idx" ON "DocumentIntake"("organizationId", "valantDocumentId");
