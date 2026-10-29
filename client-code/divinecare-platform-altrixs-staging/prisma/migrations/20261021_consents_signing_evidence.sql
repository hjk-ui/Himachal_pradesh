-- ============================================================================
-- MIGRATION: 20261021_consents_signing_evidence.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: consents brought to the industry standard (athenaOne / Valant / TherapyNotes / SimplePractice
--   consent and ROI management). A consent packet now records how the client was told about it
--   (portal / email / SMS, with resend count and last send), when the client first opened it, and
--   the e-signature evidence captured at signing (signature method, IP address and user agent for an
--   electronic signature, portal login, staff witness, interpreter and language, scanned paper
--   reference, and the SHA-256 of every section's rendered text). See src/lib/consents/library/evidence.ts.
-- CHANGES:
--   * "ConsentPacket"  + deliveryChannels TEXT[] (portal | email | sms), lastSentAt, sendCount,
--                      viewedAt, evidence JSONB.
-- DATA: existing packets keep working; their evidence is null (signed before this migration) and the
--   PDF shows only the signature record they already have.
-- ============================================================================

ALTER TABLE "ConsentPacket" ADD COLUMN IF NOT EXISTS "deliveryChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ConsentPacket" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);
ALTER TABLE "ConsentPacket" ADD COLUMN IF NOT EXISTS "sendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConsentPacket" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);
ALTER TABLE "ConsentPacket" ADD COLUMN IF NOT EXISTS "evidence" JSONB;
