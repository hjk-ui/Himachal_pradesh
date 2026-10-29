-- ============================================================================
-- MIGRATION: 20261023_note_dismiss.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: prescriber feedback (staging): an unsigned note that is not needed any more (created in
--   error, duplicate, visit didn't happen) can be dismissed from the note view / worklist.
--   Clinical drafts are never hard-deleted: the note is marked dismissed with who, when and why,
--   drops out of the documentation queues (To write / Drafts / Overdue / deadline counts) and
--   stays retrievable read-only for leadership and audit ("Include dismissed" in All notes).
--   The author can undo within 30 days. Signed / locked / co-signed notes cannot be dismissed.
--   Dismiss and undo are audit-logged (NOTE_DISMISS / NOTE_DISMISS_UNDO).
-- ============================================================================

ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissedById" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissedByName" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissReason" TEXT;
