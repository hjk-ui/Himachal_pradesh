-- ============================================================================
-- MIGRATION: 20261019_scribe_core.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: AI Scribe upgrade (docs/ai-scribe.md)
--   * scribe_settings      practice settings (enabled, transcript retention days, default format,
--                          client summary sharing, live cues). Recording consent is always required
--                          (Maryland all-party consent) and is NOT a column.
--   * scribe_preferences   per-clinician drafting preferences
--   * scribe_captures      one capture session + the recording-consent attestation (who / when /
--                          participants / method), speaker-label corrections, usage metering,
--                          retention timestamps and the plain-language client summary
--   * scribe_segments      finalized transcript turns (raw speaker label, session-clock ms, text)
--   * scribe_drafts        grounded AI drafts with provenance (citations are line ids, no copies)
--   * scribe_follow_ups    follow-ups the clinician accepted (listed in My To-Do)
-- No audio is stored anywhere. The legacy "ScribeSession" table is not touched.
-- Data lives in the KMS-encrypted RDS instance; segments are deleted by the retention job.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "scribe_settings" (
  "id"                        TEXT PRIMARY KEY,
  "organization_id"           TEXT NOT NULL,
  "enabled"                   BOOLEAN NOT NULL DEFAULT true,
  "transcript_retention_days" INTEGER NOT NULL DEFAULT 30,
  "default_format"            VARCHAR(40) NOT NULL DEFAULT 'THERAPY_PROGRESS',
  "client_summary_sharing"    BOOLEAN NOT NULL DEFAULT false,
  "live_cues_default"         BOOLEAN NOT NULL DEFAULT true,
  "updated_by_id"             TEXT,
  "created_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_settings_organization_id_key" ON "scribe_settings" ("organization_id");

CREATE TABLE IF NOT EXISTS "scribe_preferences" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "default_format"  VARCHAR(40),
  "verbosity"       VARCHAR(12) NOT NULL DEFAULT 'standard',
  "client_term"     VARCHAR(12) NOT NULL DEFAULT 'client',
  "pronouns"        VARCHAR(8) NOT NULL DEFAULT 'they',
  "phrase_keys"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "live_cues"       BOOLEAN,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_preferences_organization_id_user_id_key" ON "scribe_preferences" ("organization_id", "user_id");

CREATE TABLE IF NOT EXISTS "scribe_captures" (
  "id"                            TEXT PRIMARY KEY,
  "organization_id"               TEXT NOT NULL,
  "client_id"                     TEXT NOT NULL,
  "clinician_id"                  TEXT NOT NULL,
  "appointment_id"                TEXT,
  "telehealth_session_id"         TEXT,
  "mode"                          VARCHAR(16) NOT NULL,
  "engine"                        VARCHAR(40) NOT NULL,
  "status"                        VARCHAR(16) NOT NULL DEFAULT 'ready',
  "note_format"                   VARCHAR(40),
  "part2"                         BOOLEAN NOT NULL DEFAULT false,
  "ai_consent_status"             VARCHAR(10) NOT NULL,
  "consent_method"                VARCHAR(10),
  "consent_participants"          JSONB,
  "consent_clinician_only"        BOOLEAN NOT NULL DEFAULT false,
  "consent_script_version"        VARCHAR(20),
  "consent_attested_by_id"        TEXT NOT NULL,
  "consent_attested_by_name"      TEXT,
  "consent_attested_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "consent_withdrawn_at"          TIMESTAMPTZ(6),
  "speaker_map"                   JSONB,
  "live_cues"                     BOOLEAN NOT NULL DEFAULT true,
  "started_at"                    TIMESTAMPTZ(6),
  "stopped_at"                    TIMESTAMPTZ(6),
  "capture_seconds"               INTEGER NOT NULL DEFAULT 0,
  "stream_count"                  INTEGER NOT NULL DEFAULT 0,
  "draft_count"                   INTEGER NOT NULL DEFAULT 0,
  "progress_note_id"              TEXT,
  "note_signed_at"                TIMESTAMPTZ(6),
  "transcript_purge_after"        TIMESTAMPTZ(6),
  "transcript_purged_at"          TIMESTAMPTZ(6),
  "client_summary"                TEXT,
  "client_summary_status"         VARCHAR(10),
  "client_summary_approved_by_id" TEXT,
  "client_summary_shared_at"      TIMESTAMPTZ(6),
  "created_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scribe_captures_organization_id_client_id_idx" ON "scribe_captures" ("organization_id", "client_id");
CREATE INDEX IF NOT EXISTS "scribe_captures_organization_id_clinician_id_created_at_idx" ON "scribe_captures" ("organization_id", "clinician_id", "created_at");
CREATE INDEX IF NOT EXISTS "scribe_captures_progress_note_id_idx" ON "scribe_captures" ("progress_note_id");
CREATE INDEX IF NOT EXISTS "scribe_captures_transcript_purge_after_idx" ON "scribe_captures" ("transcript_purge_after");

CREATE TABLE IF NOT EXISTS "scribe_segments" (
  "id"              TEXT PRIMARY KEY,
  "session_id"      TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "seq"             INTEGER NOT NULL,
  "speaker_label"   VARCHAR(80) NOT NULL,
  "start_ms"        INTEGER NOT NULL,
  "end_ms"          INTEGER NOT NULL,
  "text"            TEXT NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_segments_session_id_seq_key" ON "scribe_segments" ("session_id", "seq");
CREATE INDEX IF NOT EXISTS "scribe_segments_organization_id_idx" ON "scribe_segments" ("organization_id");

CREATE TABLE IF NOT EXISTS "scribe_drafts" (
  "id"              TEXT PRIMARY KEY,
  "session_id"      TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "client_id"       TEXT NOT NULL,
  "created_by_id"   TEXT NOT NULL,
  "format"          VARCHAR(40) NOT NULL,
  "model_id"        VARCHAR(120) NOT NULL,
  "content"         JSONB NOT NULL,
  "sentence_count"  INTEGER NOT NULL DEFAULT 0,
  "withheld_count"  INTEGER NOT NULL DEFAULT 0,
  "flagged_count"   INTEGER NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scribe_drafts_session_id_created_at_idx" ON "scribe_drafts" ("session_id", "created_at");

CREATE TABLE IF NOT EXISTS "scribe_follow_ups" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "session_id"      TEXT,
  "client_id"       TEXT NOT NULL,
  "owner_id"        TEXT NOT NULL,
  "kind"            VARCHAR(16) NOT NULL,
  "title"           VARCHAR(200) NOT NULL,
  "detail"          VARCHAR(500),
  "href"            VARCHAR(300),
  "status"          VARCHAR(10) NOT NULL DEFAULT 'OPEN',
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at"    TIMESTAMPTZ(6)
);
CREATE INDEX IF NOT EXISTS "scribe_follow_ups_organization_id_owner_id_status_idx" ON "scribe_follow_ups" ("organization_id", "owner_id", "status");
CREATE INDEX IF NOT EXISTS "scribe_follow_ups_client_id_idx" ON "scribe_follow_ups" ("client_id");

-- Foreign keys (added once; a re-run skips existing constraints)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_segments_session_id_fkey') THEN
    ALTER TABLE "scribe_segments" ADD CONSTRAINT "scribe_segments_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "scribe_captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_drafts_session_id_fkey') THEN
    ALTER TABLE "scribe_drafts" ADD CONSTRAINT "scribe_drafts_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "scribe_captures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_follow_ups_session_id_fkey') THEN
    ALTER TABLE "scribe_follow_ups" ADD CONSTRAINT "scribe_follow_ups_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "scribe_captures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- PHI rows follow the client and the organization when either is deleted
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_captures_client_id_fkey') THEN
    ALTER TABLE "scribe_captures" ADD CONSTRAINT "scribe_captures_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_captures_organization_id_fkey') THEN
    ALTER TABLE "scribe_captures" ADD CONSTRAINT "scribe_captures_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_follow_ups_client_id_fkey') THEN
    ALTER TABLE "scribe_follow_ups" ADD CONSTRAINT "scribe_follow_ups_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scribe_settings_organization_id_fkey') THEN
    ALTER TABLE "scribe_settings" ADD CONSTRAINT "scribe_settings_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
