-- Smart Document Intake: split a multi-patient upload into one document per patient.
-- Idempotent: safe to run more than once.
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "pageTexts" JSONB;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "pageNumbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
CREATE INDEX IF NOT EXISTS "DocumentIntake_parentId_idx" ON "DocumentIntake" ("parentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentIntake_parentId_fkey') THEN
    ALTER TABLE "DocumentIntake"
      ADD CONSTRAINT "DocumentIntake_parentId_fkey" FOREIGN KEY ("parentId")
      REFERENCES "DocumentIntake" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
