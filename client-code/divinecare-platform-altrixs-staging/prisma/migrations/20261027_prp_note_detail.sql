-- ============================================================================
-- MIGRATION: 20261027_prp_note_detail.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No rows are written.
-- WHY: the PRP progress note (owner's paper form review, Oct 27) gets structured contact fields:
--   location on-site / off-site (+ community location), individuals involved, the IRP objectives
--   addressed, interventions (picklist), progress, collaboration with the treatment team, and the
--   participant's signature or the reason it was not obtained. Date, start / end time and the
--   contact type (in person / telehealth video / audio-only) stay on the note and its Service
--   details. src/lib/prp/progressNote.ts, src/lib/prp/progressNoteDb.ts.
-- ADDS: progress_note_prp_details (one row per PRP note; draft-only edits, frozen once signed).
-- NOT TOUCHED: "ProgressNote" gets NO new columns (it is queried without select in many places).
-- ============================================================================

CREATE TABLE IF NOT EXISTS progress_note_prp_details (
  "noteId"                      TEXT PRIMARY KEY REFERENCES "ProgressNote"("id") ON DELETE CASCADE,
  "location"                    TEXT,
  "communityLocation"           TEXT,
  "participants"                TEXT[] NOT NULL DEFAULT ARRAY['patient']::TEXT[],
  "participantsOther"           TEXT,
  "objectives"                  JSONB NOT NULL DEFAULT '[]'::JSONB,
  "objectiveOther"              TEXT,
  "interventions"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "progress"                    TEXT,
  "collaboration"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "collaborationNote"           TEXT,
  "patientSignatureStatus"      TEXT,
  "patientSignatureName"        TEXT,
  "patientSignedAt"             TIMESTAMP(3),
  "patientSignatureReason"      TEXT,
  "patientSignatureReasonOther" TEXT,
  "updatedById"                 TEXT,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progress_note_prp_details_location_chk') THEN
    ALTER TABLE progress_note_prp_details ADD CONSTRAINT progress_note_prp_details_location_chk
      CHECK ("location" IS NULL OR "location" IN ('onsite', 'offsite'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progress_note_prp_details_signature_chk') THEN
    ALTER TABLE progress_note_prp_details ADD CONSTRAINT progress_note_prp_details_signature_chk
      CHECK ("patientSignatureStatus" IS NULL OR "patientSignatureStatus" IN ('signed', 'not_obtained'));
  END IF;
END $$;
