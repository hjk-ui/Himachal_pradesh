-- Safe production schema patch for MRN (idempotent).
-- Run AGAINST LIVE DB BEFORE deploying app code that selects Organization.mrnNextSequence.
-- Example:
--   psql "$DATABASE_URL" -f prisma/sql/add-mrn-columns.sql
-- Or: npx prisma db execute --file prisma/sql/add-mrn-columns.sql

BEGIN;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "mrnNextSequence" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "mrn" TEXT;

-- FK (ignore if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Client_organizationId_fkey'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Client_organizationId_idx" ON "Client"("organizationId");
CREATE INDEX IF NOT EXISTS "Client_mrn_idx" ON "Client"("mrn");

-- Unique (org, mrn). Postgres allows multiple NULLs in unique columns.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Client_organizationId_mrn_key'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_organizationId_mrn_key"
      UNIQUE ("organizationId", "mrn");
  END IF;
END $$;

COMMIT;
