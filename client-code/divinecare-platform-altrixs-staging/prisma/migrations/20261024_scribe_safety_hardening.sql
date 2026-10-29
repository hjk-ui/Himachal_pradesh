-- ============================================================================
-- MIGRATION: 20261024_scribe_safety_hardening.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE: AI Scribe safety hardening (docs/ai-scribe.md, docs/ai-note-quality.md)
--   * scribe_captures.paused_at / paused_seconds
--                                    session clock: the current pause start and the total paused
--                                    seconds (note start / end time and minutes come from the capture)
--   * scribe_captures.risk_findings  transcript risk scan (line id, time, category, concept,
--                                    severity; no quotes). A note linked to a capture with findings
--                                    signs only with a documented C-SSRS / risk level / safety plan
--                                    update, or the clinician's risk attestation below
--   * scribe_captures.risk_attestation / risk_attested_at / risk_attested_by_id
--                                    "Risk content was reviewed; no further assessment indicated
--                                    because …" (audited SCRIBE_RISK_ATTESTATION)
--   * scribe_captures.speakers_confirmed_at / speakers_confirmed_by_id
--                                    inferred speaker labels confirmed before drafting
--   * "ProgressNote"."aiProvenance"  AI audit evidence stamped at signing (per-section edit ratio
--                                    draft → signed, withheld / weak / flagged counts, model id,
--                                    prompt version, capture id), kept after the transcript purge
-- ============================================================================

ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMPTZ(6);
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "paused_seconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "risk_findings" JSONB;
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "risk_attestation" TEXT;
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "risk_attested_at" TIMESTAMPTZ(6);
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "risk_attested_by_id" TEXT;
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "speakers_confirmed_at" TIMESTAMPTZ(6);
ALTER TABLE "scribe_captures" ADD COLUMN IF NOT EXISTS "speakers_confirmed_by_id" TEXT;

ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "aiProvenance" JSONB;
