-- ============================================================================
-- MIGRATION: 20261025_note_format_enforcement.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Notes policy. Missing note-format elements (src/lib/notes/formatElements.ts) are warnings
--   until this practice date (YYYY-MM-DD, practice time zone), then they block signing.
--   NULL = the default, 2026-11-16.
-- ============================================================================
ALTER TABLE "NotePolicySettings" ADD COLUMN IF NOT EXISTS "formatElementsEnforceFrom" TEXT;
