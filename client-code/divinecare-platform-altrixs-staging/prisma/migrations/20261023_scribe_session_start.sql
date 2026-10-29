-- ============================================================================
-- MIGRATION: 20261023_scribe_session_start.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: AI Scribe one-click session start, delete-on-sign, upload / recap, Spanish, groups
--        (docs/ai-scribe.md)
--   * scribe_settings.delete_transcript_on_sign  practice setting, default ON: the transcript and
--     AI drafts of a capture are deleted as soon as the note created from it is signed. The
--     day-based retention stays as the fallback for captures never turned into a signed note.
--   * scribe_captures.language       'en-US' (default) | 'es-US' (capture language; the note is
--                                    always drafted in English)
--   * scribe_captures.source         'live' (default) | 'upload' (audio file, batch Transcribe) |
--                                    'recap' (clinician's post-session dictated recap)
--   * scribe_captures.audio_object_key / batch_job_name / audio_deleted_at
--                                    upload only: the S3 object (deleted as soon as the transcript
--                                    exists) and the Transcribe batch job (deleted with it)
--   * scribe_group_captures / scribe_group_segments
--                                    one capture of a group session (IOP / PHP / therapy / SUD
--                                    group): recording attestation per member, AI consent per
--                                    member, speaker → member mapping, the grounded group draft
-- No audio is kept: an uploaded file is deleted when its transcript exists.
-- ============================================================================

ALTER TABLE "scribe_settings" ADD COLUMN IF NOT EXISTS "delete_transcript_on_sign" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "language" VARCHAR(8) NOT NULL DEFAULT 'en-US';
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "source" VARCHAR(12) NOT NULL DEFAULT 'live';
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "audio_object_key" VARCHAR(300);
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "batch_job_name" VARCHAR(200);
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "audio_deleted_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "scribe_group_captures" (
  "id"                       TEXT PRIMARY KEY,
  "organization_id"          TEXT NOT NULL,
  "group_session_id"         TEXT NOT NULL,
  "group_id"                 TEXT NOT NULL,
  "clinician_id"             TEXT NOT NULL,
  "engine"                   VARCHAR(40) NOT NULL,
  "language"                 VARCHAR(8) NOT NULL DEFAULT 'en-US',
  "status"                   VARCHAR(16) NOT NULL DEFAULT 'ready',
  "part2"                    BOOLEAN NOT NULL DEFAULT false,
  "members"                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  "consent_participants"     JSONB,
  "consent_script_version"   VARCHAR(20),
  "consent_attested_by_id"   TEXT NOT NULL,
  "consent_attested_by_name" TEXT,
  "consent_attested_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "consent_withdrawn_at"     TIMESTAMPTZ(6),
  "speaker_map"              JSONB,
  "draft"                    JSONB,
  "started_at"               TIMESTAMPTZ(6),
  "stopped_at"               TIMESTAMPTZ(6),
  "capture_seconds"          INTEGER NOT NULL DEFAULT 0,
  "stream_count"             INTEGER NOT NULL DEFAULT 0,
  "draft_count"              INTEGER NOT NULL DEFAULT 0,
  "applied_at"               TIMESTAMPTZ(6),
  "transcript_purge_after"   TIMESTAMPTZ(6),
  "transcript_purged_at"     TIMESTAMPTZ(6),
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scribe_group_captures_organization_id_group_session_id_idx" ON "scribe_group_captures" ("organization_id", "group_session_id");
CREATE INDEX IF NOT EXISTS "scribe_group_captures_transcript_purged_at_idx" ON "scribe_group_captures" ("transcript_purged_at");

CREATE TABLE IF NOT EXISTS "scribe_group_segments" (
  "id"              TEXT PRIMARY KEY,
  "capture_id"      TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "seq"             INTEGER NOT NULL,
  "speaker_label"   VARCHAR(80) NOT NULL,
  "start_ms"        INTEGER NOT NULL,
  "end_ms"          INTEGER NOT NULL,
  "text"            TEXT NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_group_segments_capture_id_seq_key" ON "scribe_group_segments" ("capture_id", "seq");
CREATE INDEX IF NOT EXISTS "scribe_group_segments_organization_id_idx" ON "scribe_group_segments" ("organization_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_group_segments_capture_id_fkey') THEN
    ALTER TABLE "scribe_group_segments" ADD CONSTRAINT "scribe_group_segments_capture_id_fkey"
      FOREIGN KEY ("capture_id") REFERENCES "scribe_group_captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
