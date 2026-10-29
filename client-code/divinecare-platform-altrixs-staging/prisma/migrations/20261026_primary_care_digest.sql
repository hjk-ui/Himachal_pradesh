-- ============================================================================
-- MIGRATION: 20261026_primary_care_digest.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Medical (primary care) chart history digest beside the behavioral health one
--   (src/lib/ai/chartDigest/medical/**). "ClientChartDigest"."kind" = 'bh' | 'medical'; versions
--   and staleness (source hash) are kept per kind, so the unique key becomes
--   (organizationId, clientId, kind, version). Existing rows are behavioral health ('bh').
-- Run this AFTER 20261026_chart_history_digest.sql and BEFORE deploying the matching code.
-- ============================================================================

ALTER TABLE "ClientChartDigest" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'bh';

DROP INDEX IF EXISTS "ClientChartDigest_organizationId_clientId_version_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ClientChartDigest_organizationId_clientId_kind_version_key"
  ON "ClientChartDigest" ("organizationId", "clientId", "kind", "version");
CREATE INDEX IF NOT EXISTS "ClientChartDigest_organizationId_clientId_kind_generatedAt_idx"
  ON "ClientChartDigest" ("organizationId", "clientId", "kind", "generatedAt");
