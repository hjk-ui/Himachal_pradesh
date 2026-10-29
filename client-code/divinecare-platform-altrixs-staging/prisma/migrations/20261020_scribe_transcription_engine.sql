-- ============================================================================
-- MIGRATION: 20261020_scribe_transcription_engine.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: AI Scribe transcription engine setting (docs/ai-scribe.md, docs/pricing-model.md)
--   * scribe_settings.transcription_engine  'standard' (default; Amazon Transcribe streaming with the
--     practice's behavioral-health custom vocabulary) or 'medical' (Amazon Transcribe Medical).
-- Existing practices move to 'standard' (owner decision 2026-10-20). Captures already created keep
-- the engine recorded on scribe_captures.engine.
-- ============================================================================

ALTER TABLE "scribe_settings" ADD COLUMN IF NOT EXISTS "transcription_engine" VARCHAR(16) NOT NULL DEFAULT 'standard';
