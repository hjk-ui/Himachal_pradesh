-- ============================================================================
-- MIGRATION: 20261021_aot_documents.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: the Maryland Department of Health (BHA) publishes six Assisted Outpatient Treatment forms
--   (revised 06/25/2026): AOT Treatment Plan (MDH#0001BHA), Non-Responsive Respondent letter
--   (MDH#0002BHA), Notification of Petition for Emergency Evaluation (MDH#0003BHA), Psychiatrist
--   Affidavit (MDH#0004BHA), Plan for Continued Treatment, and the AOT Complaint/Incident Report.
--   Altrixs stores each as a structured, versioned document per participant. Nothing is sent to the
--   state: staff review, sign, print / save as PDF and send the documents themselves.
-- CHANGES:
--   * aot_documents          one row per form version: form_type, version, status
--                            (draft | signed | superseded), data (jsonb, shape in src/lib/aot/forms),
--                            signer + time (set by the server on sign; the row is locked after).
--                            An amendment is a new version; signing it supersedes the prior signed one.
--   * aot_outreach_attempts  engagement attempts (date, method, staff role, result) used by the
--                            treatment plan engagement section and the non-responsive letter.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aot_documents (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" TEXT NOT NULL,
  "participant_id"  TEXT NOT NULL,
  "client_id"       TEXT,
  "form_type"       TEXT NOT NULL,
  "version"         INTEGER NOT NULL DEFAULT 1,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "data"            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "signed_by_id"    TEXT,
  "signed_by_name"  TEXT,
  "signed_at"       TIMESTAMPTZ(6),
  "created_by_id"   TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "aot_documents_participant_id_form_type_version_key" ON aot_documents ("participant_id", "form_type", "version");
CREATE INDEX IF NOT EXISTS "aot_documents_participant_id_form_type_idx" ON aot_documents ("participant_id", "form_type");
CREATE INDEX IF NOT EXISTS "aot_documents_organization_id_idx"         ON aot_documents ("organization_id");

CREATE TABLE IF NOT EXISTS aot_outreach_attempts (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" TEXT NOT NULL,
  "participant_id"  TEXT NOT NULL,
  "attempted_at"    TIMESTAMPTZ(6) NOT NULL,
  "method"          TEXT NOT NULL,
  "staff_role"      TEXT NOT NULL,
  "result"          TEXT NOT NULL,
  "created_by_id"   TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "aot_outreach_attempts_participant_id_attempted_at_idx" ON aot_outreach_attempts ("participant_id", "attempted_at");
CREATE INDEX IF NOT EXISTS "aot_outreach_attempts_organization_id_idx"              ON aot_outreach_attempts ("organization_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_documents_participant_id_fkey') THEN
    ALTER TABLE aot_documents ADD CONSTRAINT "aot_documents_participant_id_fkey"
      FOREIGN KEY ("participant_id") REFERENCES "AotParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_documents_form_type_check') THEN
    ALTER TABLE aot_documents ADD CONSTRAINT "aot_documents_form_type_check"
      CHECK ("form_type" IN ('treatment_plan', 'psychiatrist_affidavit', 'ep_notification',
                             'continued_treatment_plan', 'nonresponsive_letter', 'complaint'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_documents_status_check') THEN
    ALTER TABLE aot_documents ADD CONSTRAINT "aot_documents_status_check"
      CHECK ("status" IN ('draft', 'signed', 'superseded'));
  END IF;
  -- A signed (or superseded) document always records who signed and when
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_documents_signed_check') THEN
    ALTER TABLE aot_documents ADD CONSTRAINT "aot_documents_signed_check"
      CHECK ("status" = 'draft' OR ("signed_at" IS NOT NULL AND "signed_by_id" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_outreach_attempts_participant_id_fkey') THEN
    ALTER TABLE aot_outreach_attempts ADD CONSTRAINT "aot_outreach_attempts_participant_id_fkey"
      FOREIGN KEY ("participant_id") REFERENCES "AotParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_outreach_attempts_method_check') THEN
    ALTER TABLE aot_outreach_attempts ADD CONSTRAINT "aot_outreach_attempts_method_check"
      CHECK ("method" IN ('phone', 'mail', 'in_person', 'text', 'email', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aot_outreach_attempts_staff_role_check') THEN
    ALTER TABLE aot_outreach_attempts ADD CONSTRAINT "aot_outreach_attempts_staff_role_check"
      CHECK ("staff_role" IN ('cprs', 'case_manager', 'psychiatrist', 'other'));
  END IF;
END $$;
