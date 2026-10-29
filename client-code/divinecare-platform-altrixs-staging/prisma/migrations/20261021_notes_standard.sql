-- ============================================================================
-- MIGRATION: 20261021_notes_standard.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: Progress notes brought to the documentation standard of TherapyNotes / Valant /
--   SimplePractice / athenaOne BH / myAvatar (src/lib/notes/standard.ts):
--   * "ProgressNoteServiceDetail"     billing elements that are not note text: start / end time,
--                                     telehealth modality (audio-video / audio-only), patient
--                                     location + state, telehealth consent, linked chart ICD-10
--                                     codes in pointer order.
--   * "ProgressNoteTimeliness"        stamped at signature: due time under the practice's sign
--                                     deadline and the late-entry label when signed after it.
--   * "ProgressNotePsychotherapyNote" HIPAA psychotherapy notes (45 CFR 164.501), author-only,
--                                     never printed / exported / released / copied forward.
--   * "NoteAmendmentRequest"          patient-requested amendments (45 CFR 164.526): 60-day
--                                     due date, accept (linked addendum) or deny with reason.
--   * "NotePolicySettings"            stale-draft days, clone warning %, diagnosis-to-sign rule.
-- Plain id columns (no FKs to ProgressNote) match prisma/schema.prisma (no relations modeled).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ProgressNoteServiceDetail" (
  "noteId"               TEXT PRIMARY KEY,
  "startTime"            VARCHAR(5),
  "endTime"              VARCHAR(5),
  "telehealthModality"   TEXT,
  "patientLocationType"  TEXT,
  "patientLocationState" VARCHAR(2),
  "telehealthConsent"    BOOLEAN,
  "diagnosisCodes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedById"          TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ProgressNoteTimeliness" (
  "noteId"         TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "dueAt"          TIMESTAMP(3) NOT NULL,
  "signedAt"       TIMESTAMP(3) NOT NULL,
  "deadlineHours"  INTEGER NOT NULL,
  "lateEntry"      BOOLEAN NOT NULL DEFAULT FALSE,
  "label"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProgressNoteTimeliness_organizationId_lateEntry_idx"
  ON "ProgressNoteTimeliness" ("organizationId", "lateEntry");

CREATE TABLE IF NOT EXISTS "ProgressNotePsychotherapyNote" (
  "noteId"         TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "authorId"       TEXT NOT NULL,
  "text"           TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProgressNotePsychotherapyNote_authorId_idx"
  ON "ProgressNotePsychotherapyNote" ("authorId");

CREATE TABLE IF NOT EXISTS "NoteAmendmentRequest" (
  "id"                    TEXT PRIMARY KEY,
  "organizationId"        TEXT NOT NULL,
  "clientId"              TEXT NOT NULL,
  "noteId"                TEXT,
  "requestedBy"           TEXT NOT NULL,
  "requestedOn"           DATE NOT NULL,
  "requestText"           TEXT NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'PENDING',
  "dueOn"                 DATE NOT NULL,
  "extendedOn"            DATE,
  "extensionReason"       TEXT,
  "decisionReason"        TEXT,
  "decidedById"           TEXT,
  "decidedByName"         TEXT,
  "decidedAt"             TIMESTAMP(3),
  "addendumId"            TEXT,
  "disagreementStatement" TEXT,
  "createdById"           TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NoteAmendmentRequest_organizationId_status_idx" ON "NoteAmendmentRequest" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "NoteAmendmentRequest_clientId_idx"              ON "NoteAmendmentRequest" ("clientId");
CREATE INDEX IF NOT EXISTS "NoteAmendmentRequest_noteId_idx"                ON "NoteAmendmentRequest" ("noteId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NoteAmendmentRequest_status_check') THEN
    ALTER TABLE "NoteAmendmentRequest" ADD CONSTRAINT "NoteAmendmentRequest_status_check"
      CHECK ("status" IN ('PENDING', 'ACCEPTED', 'DENIED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProgressNoteServiceDetail_modality_check') THEN
    ALTER TABLE "ProgressNoteServiceDetail" ADD CONSTRAINT "ProgressNoteServiceDetail_modality_check"
      CHECK ("telehealthModality" IS NULL OR "telehealthModality" IN ('audio_video', 'audio_only'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "NotePolicySettings" (
  "organizationId"         TEXT PRIMARY KEY,
  "staleDraftDays"         INTEGER NOT NULL DEFAULT 14,
  "cloneWarnPercent"       INTEGER NOT NULL DEFAULT 85,
  "requireDiagnosisToSign" BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedById"            TEXT,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
