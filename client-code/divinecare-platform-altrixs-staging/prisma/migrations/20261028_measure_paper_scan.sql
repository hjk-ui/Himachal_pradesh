-- ============================================================================
-- MIGRATION: 20261028_measure_paper_scan.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No rows are written.
-- WHY: completed paper measures entered from the chart (Assessments & outcomes > Upload paper
--   measure). The record keeps a link to the filed scan (DocumentIntake, type "Measures", filed to
--   Chart > Documents > Measures). Paper rows use source = 'paper' and administrationType = 'Paper'
--   (existing text columns, no change).
-- ADDS: ClinicalAssessmentRecord."sourceDocumentId" TEXT NULL.
-- NOTE: ClinicalAssessmentRecord is read without `select` in GET /api/clinical/assessments
--   (include answers) and other places: apply this BEFORE deploying the code.
-- ============================================================================

ALTER TABLE "ClinicalAssessmentRecord" ADD COLUMN IF NOT EXISTS "sourceDocumentId" TEXT;
