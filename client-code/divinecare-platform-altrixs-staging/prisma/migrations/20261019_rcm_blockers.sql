-- ============================================================================
-- MIGRATION: 20261019_rcm_blockers.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Revenue-cycle audit blockers (B1-B8, H1, H6, H7) before go-live:
--   * claims take DOS + rendering from the note, cross-checked against the appointment the note
--     was started from (no more "nearest completed appointment" guess)
--   * supervised (pre-licensed) clinicians: per-payer rule, 2310D supervising provider
--   * provider taxonomy (PRV) for 2000A / 2310B, legal names for NM1 (no display-name parsing)
--   * audio-only telehealth per-payer modifier, timely filing limit per payer
--   * 837 ISA13 / GS06 from a database sequence (unique, monotonic) instead of Math.random
-- ADDS:
--   * ProgressNote."appointmentId" TEXT NULL (FK Appointment ON DELETE SET NULL) + index
--   * ProgressNote."audioOnly" BOOLEAN, "addOnCptCode" TEXT, "psychotherapyMinutes" INT
--   * User."legalFirstName", "legalLastName", "credentials", "taxonomyCode"
--   * Location."npiVerified" BOOLEAN (only a verified site NPI is sent in 2310C)
--   * billing_providers.taxonomy_code
--   * waystar_payer_mappings.supervisee_claims, require_taxonomy, audio_only_modifier, filing_limit_days
--   * SEQUENCE waystar_interchange_control_seq (ISA13 is 9 digits: 1..999999999, NO CYCLE)
-- DEFAULTS SET ON EXISTING PAYER ROWS (only where the column still has its fresh default, so a
-- value billing already chose is never overwritten):
--   * Medicare (claim_filing_code MB/MA or name contains "medicare"): supervisee_claims = not_allowed,
--     audio_only_modifier = 93, filing_limit_days = 365
--   * Medicaid / PBHS (claim_filing_code MC): require_taxonomy = TRUE, filing_limit_days = 365
--   * CareFirst (name contains "carefirst"): filing_limit_days = 180
--   Filing limits are starting values to VERIFY against each payer contract (notes column says so).
-- NOT TOUCHED: existing notes are not linked to appointments here; run
--   scripts/backfill-note-appointments.ts (dry run by default) for that.
-- ============================================================================

ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "audioOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "addOnCptCode" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "psychotherapyMinutes" INTEGER;
CREATE INDEX IF NOT EXISTS "ProgressNote_appointmentId_idx" ON "ProgressNote"("appointmentId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProgressNote_appointmentId_fkey') THEN
    ALTER TABLE "ProgressNote" ADD CONSTRAINT "ProgressNote_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legalFirstName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "legalLastName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "credentials" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "taxonomyCode" VARCHAR(10);

ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "npiVerified" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'billing_providers') THEN
    ALTER TABLE billing_providers ADD COLUMN IF NOT EXISTS taxonomy_code VARCHAR(10);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'waystar_payer_mappings') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'waystar_payer_mappings' AND column_name = 'supervisee_claims') THEN
      ALTER TABLE waystar_payer_mappings ADD COLUMN supervisee_claims VARCHAR(24) NOT NULL DEFAULT 'supervisee_with_2310D';
      UPDATE waystar_payer_mappings SET supervisee_claims = 'not_allowed'
       WHERE claim_filing_code IN ('MB', 'MA') OR payer_name ILIKE '%medicare%';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'waystar_payer_mappings' AND column_name = 'require_taxonomy') THEN
      ALTER TABLE waystar_payer_mappings ADD COLUMN require_taxonomy BOOLEAN NOT NULL DEFAULT FALSE;
      UPDATE waystar_payer_mappings SET require_taxonomy = TRUE WHERE claim_filing_code = 'MC';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'waystar_payer_mappings' AND column_name = 'audio_only_modifier') THEN
      ALTER TABLE waystar_payer_mappings ADD COLUMN audio_only_modifier VARCHAR(12) NOT NULL DEFAULT 'not_allowed';
      UPDATE waystar_payer_mappings SET audio_only_modifier = '93'
       WHERE claim_filing_code IN ('MB', 'MA') OR payer_name ILIKE '%medicare%';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'waystar_payer_mappings' AND column_name = 'filing_limit_days') THEN
      ALTER TABLE waystar_payer_mappings ADD COLUMN filing_limit_days INTEGER;
      UPDATE waystar_payer_mappings SET filing_limit_days = 365,
             notes = concat_ws(' ', notes, 'Timely filing 365 days set by 20261019_rcm_blockers: verify contract.')
       WHERE claim_filing_code IN ('MB', 'MA', 'MC') OR payer_name ILIKE '%medicare%';
      UPDATE waystar_payer_mappings SET filing_limit_days = 180,
             notes = concat_ws(' ', notes, 'Timely filing 180 days set by 20261019_rcm_blockers: verify contract.')
       WHERE filing_limit_days IS NULL AND payer_name ILIKE '%carefirst%';
    END IF;
  END IF;
END $$;

-- ISA13 / GS06 interchange + group control numbers (9 digits). Earlier files used random
-- numbers in 100000000-999999999; the sequence starts at 1, so it cannot repeat an earlier
-- file's number until 99,999,999 files have been sent.
CREATE SEQUENCE IF NOT EXISTS waystar_interchange_control_seq
  AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 999999999 NO CYCLE;

-- ── Phase 2 ─────────────────────────────────────────────────────────────────
-- Payment."idempotencyKey": one key per payment form submission; a double click or retry returns
-- the first payment instead of posting twice. Unique per organization (NULLs never collide).
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_organizationId_idempotencyKey_key" ON "Payment"("organizationId", "idempotencyKey");
