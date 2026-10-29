-- Soft-dismiss unsigned progress notes (Oct 23)
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP(3);
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissedById" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissedByName" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dismissReason" TEXT;
CREATE INDEX IF NOT EXISTS "ProgressNote_dismissedAt_idx" ON "ProgressNote"("dismissedAt");
