-- ============================================================================
-- MIGRATION: 20261027_huddle_email_notice.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Huddle sheet evening notice ("Your summary for tomorrow (N visits) is ready"). Per-user
--   opt-out for that email; NULL = on (the default). Set from the huddle page toggle.
--   The email itself is sent only when HUDDLE_EMAIL_NOTICE=on and never carries PHI (counts only).
-- ============================================================================

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "huddleEmailOptOutAt" TIMESTAMP(3);
