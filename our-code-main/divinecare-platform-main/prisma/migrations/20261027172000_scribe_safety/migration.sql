-- Oct 24 scribe safety: AI provenance + transcript risk attestation (TRANSCRIPT_RISK gate)
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "aiProvenance" JSONB;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "transcriptRiskFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "riskAttestation" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "riskAttestedAt" TIMESTAMP(3);
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "riskAttestedById" TEXT;
