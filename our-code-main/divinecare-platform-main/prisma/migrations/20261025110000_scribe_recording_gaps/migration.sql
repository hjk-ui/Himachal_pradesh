-- Oct 25 scribe field feedback: recording gaps (reconnect / NO_AUDIO)
-- There is no ScribeCapture model in this schema, so gaps are stored on the draft's ProgressNote.
-- Shape: [{ "startedAt": ISO, "endedAt": ISO | null, "reason": text }]. NULL = no gaps recorded.
-- (ClinicModuleState is not used: gaps belong to one note, not to practice settings.)
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "recordingGaps" JSONB;
