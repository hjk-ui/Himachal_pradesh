-- ============================================================================
-- MIGRATION: 20261022_notes_policy_decisions.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Documentation policy decisions (industry standard, owner-delegated 2026-10-20):
--   * Note sign deadline = 72 hours after the service (practice policy; 24 / 48 / 72 stay
--     selectable in Practice settings › Clinical). The column default moves 24 -> 72, and a
--     practice whose stored value is still the old default 24 moves to 72. A practice that chose
--     48 (or anything else) keeps its choice. Runs once: guarded on the column default still
--     being 24, so a practice that later picks 24 on purpose is never flipped back on a re-run.
--     The late-note escalation is raised to at least the new deadline (Practice settings
--     requires escalation >= deadline).
--   * "ProgressNoteTimeliness"."lateReason": the clinician's reason for a late entry, required
--     at signing after the deadline and printed under the late-entry label.
-- ============================================================================

ALTER TABLE "ProgressNoteTimeliness" ADD COLUMN IF NOT EXISTS "lateReason" TEXT;

DO $$
DECLARE
  current_default TEXT;
BEGIN
  SELECT column_default INTO current_default
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'PracticeSettings'
    AND column_name = 'noteSignDeadlineHours';

  IF current_default IS NOT NULL AND btrim(current_default) = '24' THEN
    UPDATE "PracticeSettings"
    SET "noteSignDeadlineHours" = 72,
        "lateNoteEscalationHours" = GREATEST("lateNoteEscalationHours", 72)
    WHERE "noteSignDeadlineHours" = 24;

    ALTER TABLE "PracticeSettings" ALTER COLUMN "noteSignDeadlineHours" SET DEFAULT 72;
  END IF;
END $$;
