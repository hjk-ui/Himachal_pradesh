-- Valant "Transaction Journal" import (reference only). The journal overlaps the "Transactions" export:
-- matching rows only gain facility / insurance; journal-only rows are inserted with sourceLayout 'journal'.
-- Idempotent.

ALTER TABLE "ValantTransaction" ADD COLUMN IF NOT EXISTS "facility" TEXT;
ALTER TABLE "ValantTransaction" ADD COLUMN IF NOT EXISTS "insurance" TEXT;
ALTER TABLE "ValantTransaction" ADD COLUMN IF NOT EXISTS "sourceLayout" TEXT;

CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_facility_idx" ON "ValantTransaction" ("organizationId", "facility");
