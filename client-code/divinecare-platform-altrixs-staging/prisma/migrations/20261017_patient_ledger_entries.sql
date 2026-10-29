-- Patient ledger entries: Valant opening balances and prepayment credits posted to the Altrixs ledger
-- (owner decision 2026-10-17). Insurance A/R is NOT posted (Valant run-out).
-- amountCents > 0 = patient owes, < 0 = credit. Rows are never deleted: re-posting supersedes the
-- active row and inserts its replacement; "unpost" supersedes with no replacement. Idempotent.

CREATE TABLE IF NOT EXISTS "PatientLedgerEntry" (
  "id"                 TEXT NOT NULL,
  "organizationId"     TEXT NOT NULL,
  "clientId"           TEXT NOT NULL,
  "kind"               TEXT NOT NULL,
  "amountCents"        INTEGER NOT NULL,
  "asOf"               TIMESTAMP(3) NOT NULL,
  "source"             TEXT NOT NULL,
  "sourceRef"          TEXT,
  "note"               TEXT,
  "postingBatchId"     TEXT,
  "postedById"         TEXT,
  "postedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt"       TIMESTAMP(3),
  "supersededById"     TEXT,
  "supersededByUserId" TEXT,
  CONSTRAINT "PatientLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PatientLedgerEntry_organizationId_clientId_supersededAt_idx"
  ON "PatientLedgerEntry" ("organizationId", "clientId", "supersededAt");
CREATE INDEX IF NOT EXISTS "PatientLedgerEntry_organizationId_source_kind_supersededAt_idx"
  ON "PatientLedgerEntry" ("organizationId", "source", "kind", "supersededAt");

-- At most one ACTIVE entry per patient, kind and source: a second concurrent posting fails instead of
-- double counting. (Partial index; Prisma cannot express it, so it lives only here.)
CREATE UNIQUE INDEX IF NOT EXISTS "PatientLedgerEntry_one_active_key"
  ON "PatientLedgerEntry" ("organizationId", "clientId", "kind", "source")
  WHERE "supersededAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientLedgerEntry_clientId_fkey') THEN
    ALTER TABLE "PatientLedgerEntry"
      ADD CONSTRAINT "PatientLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId")
      REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientLedgerEntry_kind_check') THEN
    ALTER TABLE "PatientLedgerEntry"
      ADD CONSTRAINT "PatientLedgerEntry_kind_check"
      CHECK ("kind" IN ('opening_balance', 'prepayment_credit', 'manual_adjustment'));
  END IF;
END $$;
