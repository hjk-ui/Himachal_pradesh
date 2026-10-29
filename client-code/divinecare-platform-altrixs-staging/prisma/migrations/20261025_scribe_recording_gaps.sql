-- ============================================================================
-- MIGRATION: 20261025_scribe_recording_gaps.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: AI Scribe recording reliability (docs/ai-scribe.md)
--   * scribe_captures.recording_gaps: gaps the browser reports when the live stream dropped and
--     reconnected, [{ "startMs": 602000, "endMs": 605000, "reason": "network_offline" }] on the
--     capture clock. Numbers and a reason enum only: no audio, no transcript text.
-- ============================================================================
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "recording_gaps" JSONB;
