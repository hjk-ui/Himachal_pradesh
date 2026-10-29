-- ============================================================================
-- MIGRATION: 20261019_incall_draft_note.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: Telehealth in-call drawer "Save to EHR" (src/app/api/telehealth/in-call/route.ts)
--   * TelehealthInCallNote."progressNoteId": the DRAFT ProgressNote created from the in-call
--     SOAP / MSE. Set once; later autosaves never overwrite the chart note.
--   * NO BACKFILL: earlier "Save to EHR" clicks only set isSavedToEhr on the session scratch note
--     and never created a chart note.
-- ============================================================================

ALTER TABLE IF EXISTS "TelehealthInCallNote" ADD COLUMN IF NOT EXISTS "progressNoteId" TEXT;
