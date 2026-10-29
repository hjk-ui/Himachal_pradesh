-- Valant reference-only imports: patient aging, insurance aging (payer A/R), combined aging, prepayments, copay rules, transactions.
-- Nothing here posts to the Altrixs ledger (no Payment / charge / claim rows). Idempotent.

CREATE TABLE IF NOT EXISTS "ValantReferenceImport" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reportType"     TEXT NOT NULL,
  "asOf"           TIMESTAMP(3),
  "periodStart"    TIMESTAMP(3),
  "periodEnd"      TIMESTAMP(3),
  "rowCount"       INTEGER NOT NULL DEFAULT 0,
  "matched"        INTEGER NOT NULL DEFAULT 0,
  "unmatched"      INTEGER NOT NULL DEFAULT 0,
  "totalsJson"     JSONB,
  "reconciles"     BOOLEAN NOT NULL DEFAULT false,
  "migrationJobId" TEXT,
  "importedById"   TEXT,
  "importedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantReferenceImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ValantReferenceImport_organizationId_reportType_importedAt_idx"
  ON "ValantReferenceImport" ("organizationId", "reportType", "importedAt");

CREATE TABLE IF NOT EXISTS "ValantAgingSnapshot" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "clientId"          TEXT,
  "valantPatientId"   TEXT NOT NULL,
  "asOf"              TIMESTAMP(3) NOT NULL,
  "bucket1Cents"      INTEGER NOT NULL,
  "bucket2Cents"      INTEGER NOT NULL,
  "bucket3Cents"      INTEGER NOT NULL,
  "bucket4Cents"      INTEGER NOT NULL,
  "bucket5Cents"      INTEGER NOT NULL,
  "totalCents"        INTEGER NOT NULL,
  "bucketsMatchTotal" BOOLEAN NOT NULL DEFAULT true,
  "importId"          TEXT NOT NULL,
  "jobId"             TEXT,
  "importedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantAgingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantAgingSnapshot_organizationId_valantPatientId_asOf_key"
  ON "ValantAgingSnapshot" ("organizationId", "valantPatientId", "asOf");
CREATE INDEX IF NOT EXISTS "ValantAgingSnapshot_organizationId_asOf_idx" ON "ValantAgingSnapshot" ("organizationId", "asOf");
CREATE INDEX IF NOT EXISTS "ValantAgingSnapshot_clientId_asOf_idx" ON "ValantAgingSnapshot" ("clientId", "asOf");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantAgingSnapshot_clientId_fkey') THEN
    ALTER TABLE "ValantAgingSnapshot"
      ADD CONSTRAINT "ValantAgingSnapshot_clientId_fkey" FOREIGN KEY ("clientId")
      REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ValantInsuranceAgingSnapshot" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "asOf"              TIMESTAMP(3) NOT NULL,
  "rowIndex"          INTEGER NOT NULL,
  "payerName"         TEXT NOT NULL,
  "bucket1Cents"      INTEGER NOT NULL,
  "bucket2Cents"      INTEGER NOT NULL,
  "bucket3Cents"      INTEGER NOT NULL,
  "bucket4Cents"      INTEGER NOT NULL,
  "bucket5Cents"      INTEGER NOT NULL,
  "totalCents"        INTEGER NOT NULL,
  "bucketsMatchTotal" BOOLEAN NOT NULL DEFAULT true,
  "importId"          TEXT NOT NULL,
  "importedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantInsuranceAgingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantInsuranceAgingSnapshot_organizationId_asOf_rowIndex_key"
  ON "ValantInsuranceAgingSnapshot" ("organizationId", "asOf", "rowIndex");
CREATE INDEX IF NOT EXISTS "ValantInsuranceAgingSnapshot_organizationId_asOf_idx"
  ON "ValantInsuranceAgingSnapshot" ("organizationId", "asOf");

CREATE TABLE IF NOT EXISTS "ValantAgingSettings" (
  "organizationId" TEXT NOT NULL,
  "labels"         JSONB NOT NULL,
  "confirmed"      BOOLEAN NOT NULL DEFAULT false,
  "confirmedById"  TEXT,
  "confirmedAt"    TIMESTAMP(3),
  "updatedById"    TEXT,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ValantAgingSettings_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE IF NOT EXISTS "ValantPrepaymentTxn" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "clientId"        TEXT,
  "valantName"      TEXT NOT NULL,
  "valantPatientId" TEXT,
  "type"            TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "date"            TIMESTAMP(3) NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "reference"       TEXT,
  "appliedTo"       TEXT,
  "secondaryDate"   TIMESTAMP(3),
  "periodStart"     TIMESTAMP(3) NOT NULL,
  "periodEnd"       TIMESTAMP(3) NOT NULL,
  "rowHash"         TEXT NOT NULL,
  "matchMethod"     TEXT,
  "unmatchedReason" TEXT,
  "assignedById"    TEXT,
  "assignedAt"      TIMESTAMP(3),
  "importId"        TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantPrepaymentTxn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantPrepaymentTxn_organizationId_rowHash_key"
  ON "ValantPrepaymentTxn" ("organizationId", "rowHash");
CREATE INDEX IF NOT EXISTS "ValantPrepaymentTxn_organizationId_clientId_idx" ON "ValantPrepaymentTxn" ("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "ValantPrepaymentTxn_organizationId_matchMethod_idx" ON "ValantPrepaymentTxn" ("organizationId", "matchMethod");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantPrepaymentTxn_clientId_fkey') THEN
    ALTER TABLE "ValantPrepaymentTxn"
      ADD CONSTRAINT "ValantPrepaymentTxn_clientId_fkey" FOREIGN KEY ("clientId")
      REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ClientCopayRule" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  "payerName"        TEXT NOT NULL,
  "providerType"     TEXT NOT NULL DEFAULT '',
  "cptRule"          TEXT NOT NULL DEFAULT '',
  "amountCents"      INTEGER NOT NULL,
  "valantLimitRaw"   TEXT,
  "valantLimitCents" INTEGER,
  "source"           TEXT NOT NULL DEFAULT 'valant',
  "importId"         TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientCopayRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientCopayRule_client_rule_key"
  ON "ClientCopayRule" ("clientId", "source", "payerName", "providerType", "cptRule");
CREATE INDEX IF NOT EXISTS "ClientCopayRule_organizationId_clientId_idx" ON "ClientCopayRule" ("organizationId", "clientId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientCopayRule_clientId_fkey') THEN
    ALTER TABLE "ClientCopayRule"
      ADD CONSTRAINT "ClientCopayRule_clientId_fkey" FOREIGN KEY ("clientId")
      REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Combined Aging (patient + insurance responsible-party lines). Phone/address are never stored.
CREATE TABLE IF NOT EXISTS "ValantCombinedAgingRow" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "clientId"          TEXT,
  "valantPatientId"   TEXT NOT NULL,
  "asOf"              TIMESTAMP(3) NOT NULL,
  "rowIndex"          INTEGER NOT NULL,
  "party"             TEXT NOT NULL,
  "payerName"         TEXT,
  "lastBilledAt"      TIMESTAMP(3),
  "bucket1Cents"      INTEGER NOT NULL,
  "bucket2Cents"      INTEGER NOT NULL,
  "bucket3Cents"      INTEGER NOT NULL,
  "bucket4Cents"      INTEGER NOT NULL,
  "bucket5Cents"      INTEGER NOT NULL,
  "totalCents"        INTEGER NOT NULL,
  "bucketsMatchTotal" BOOLEAN NOT NULL DEFAULT true,
  "importId"          TEXT NOT NULL,
  "importedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantCombinedAgingRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantCombinedAgingRow_org_asof_patient_row_key"
  ON "ValantCombinedAgingRow" ("organizationId", "asOf", "valantPatientId", "rowIndex");
CREATE INDEX IF NOT EXISTS "ValantCombinedAgingRow_organizationId_asOf_idx" ON "ValantCombinedAgingRow" ("organizationId", "asOf");
CREATE INDEX IF NOT EXISTS "ValantCombinedAgingRow_clientId_asOf_idx" ON "ValantCombinedAgingRow" ("clientId", "asOf");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantCombinedAgingRow_clientId_fkey') THEN
    ALTER TABLE "ValantCombinedAgingRow"
      ADD CONSTRAINT "ValantCombinedAgingRow_clientId_fkey" FOREIGN KEY ("clientId")
      REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Transactions (charges / payments / adjustments). Patient names are never stored.
CREATE TABLE IF NOT EXISTS "ValantTransaction" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "clientId"        TEXT,
  "valantPatientId" TEXT NOT NULL,
  "billingId"       TEXT,
  "serviceDate"     TIMESTAMP(3),
  "providerCode"    TEXT,
  "providerUserId"  TEXT,
  "pos"             TEXT,
  "diagnosis"       TEXT,
  "code"            TEXT NOT NULL,
  "codeBase"        TEXT,
  "codeSuffix"      TEXT,
  "category"        TEXT NOT NULL,
  "amountCents"     INTEGER NOT NULL,
  "note"            TEXT,
  "reportLabel"     TEXT,
  "rowHash"         TEXT NOT NULL,
  "importId"        TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantTransaction_organizationId_rowHash_key" ON "ValantTransaction" ("organizationId", "rowHash");
CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_clientId_serviceDate_idx" ON "ValantTransaction" ("organizationId", "clientId", "serviceDate");
CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_valantPatientId_idx" ON "ValantTransaction" ("organizationId", "valantPatientId");
CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_category_idx" ON "ValantTransaction" ("organizationId", "category");
CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_billingId_idx" ON "ValantTransaction" ("organizationId", "billingId");
CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_serviceDate_idx" ON "ValantTransaction" ("organizationId", "serviceDate");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ValantTransaction_clientId_fkey') THEN
    ALTER TABLE "ValantTransaction"
      ADD CONSTRAINT "ValantTransaction_clientId_fkey" FOREIGN KEY ("clientId")
      REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
