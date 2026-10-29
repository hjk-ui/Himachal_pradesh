-- ============================================================================
-- MIGRATION: 20261026_chart_history_digest.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Chart history digest for the pre-visit brief (src/lib/ai/chartDigest/**).
--   * "DocumentIntake"."textMethod" / "textExtractedAt" / "textOcrJobId": cached text extraction of
--     filed chart documents (PDF text layer first, Textract only for scanned pages). The existing
--     "extractedText" / "pageTexts" / "pageCount" columns hold the text and page count.
--   * "ClientChartDigest": one row per generated digest version per client (digest JSON with
--     citations, source keys, source hash for staleness, model, prompt version, token and cost counts).
-- Run this BEFORE deploying code built from the matching prisma/schema.prisma.
-- ============================================================================

ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "textMethod" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "textExtractedAt" TIMESTAMP(3);
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "textOcrJobId" TEXT;

CREATE TABLE IF NOT EXISTS "ClientChartDigest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "digestJson" JSONB NOT NULL DEFAULT '{}',
  "sourceDocIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceHash" TEXT NOT NULL,
  "model" TEXT,
  "promptVersion" TEXT NOT NULL,
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "costEstimateUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "generatedById" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errors" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "ClientChartDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientChartDigest_organizationId_clientId_version_key"
  ON "ClientChartDigest" ("organizationId", "clientId", "version");
CREATE INDEX IF NOT EXISTS "ClientChartDigest_organizationId_clientId_generatedAt_idx"
  ON "ClientChartDigest" ("organizationId", "clientId", "generatedAt");
