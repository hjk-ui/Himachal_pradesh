-- Additive patient-side and billing-reference tables. No drops.

ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "frequencyCode" TEXT;
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "primaryClaimId" TEXT;

ALTER TABLE "SpecializedBillingCharge" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "SpecializedBillingCharge" ADD COLUMN IF NOT EXISTS "claimId" TEXT;
CREATE INDEX IF NOT EXISTS "SpecializedBillingCharge_organizationId_status_idx" ON "SpecializedBillingCharge"("organizationId", "status");

ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER;
ALTER TABLE "DocumentIntake" ADD COLUMN IF NOT EXISTS "matchStatus" TEXT;
CREATE INDEX IF NOT EXISTS "DocumentIntake_organizationId_status_matchStatus_idx" ON "DocumentIntake"("organizationId", "status", "matchStatus");

CREATE TABLE IF NOT EXISTS "PatientLedgerEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'valant',
  "sourceRef" TEXT,
  "note" TEXT,
  "postingBatchId" TEXT,
  "postedById" TEXT,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMP(3),
  "supersededById" TEXT,
  "supersededByUserId" TEXT,
  CONSTRAINT "PatientLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PatientLedgerEntry_organizationId_clientId_supersededAt_idx" ON "PatientLedgerEntry"("organizationId", "clientId", "supersededAt");
CREATE INDEX IF NOT EXISTS "PatientLedgerEntry_organizationId_source_kind_supersededAt_idx" ON "PatientLedgerEntry"("organizationId", "source", "kind", "supersededAt");

CREATE TABLE IF NOT EXISTS "ClientCopayRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "payerName" TEXT NOT NULL,
  "providerType" TEXT NOT NULL DEFAULT '',
  "cptRule" TEXT NOT NULL DEFAULT '',
  "amountCents" INTEGER NOT NULL,
  "valantLimitRaw" TEXT,
  "valantLimitCents" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'valant',
  "importId" TEXT,
  CONSTRAINT "ClientCopayRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClientCopayRule_clientId_source_payerName_providerType_cptRule_key" ON "ClientCopayRule"("clientId", "source", "payerName", "providerType", "cptRule");
CREATE INDEX IF NOT EXISTS "ClientCopayRule_organizationId_clientId_idx" ON "ClientCopayRule"("organizationId", "clientId");

CREATE TABLE IF NOT EXISTS "ValantInsuranceAgingSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "payerName" TEXT NOT NULL,
  "bucket1Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket2Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket3Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket4Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket5Cents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "asOf" TIMESTAMP(3) NOT NULL,
  "importId" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bucketsMatchTotal" BOOLEAN NOT NULL DEFAULT true,
  "rowIndex" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ValantInsuranceAgingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ValantInsuranceAgingSnapshot_organizationId_asOf_idx" ON "ValantInsuranceAgingSnapshot"("organizationId", "asOf");

CREATE TABLE IF NOT EXISTS "ValantAgingSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "valantPatientId" TEXT,
  "bucket1Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket2Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket3Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket4Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket5Cents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "asOf" TIMESTAMP(3) NOT NULL,
  "importId" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ValantAgingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ValantAgingSnapshot_organizationId_asOf_idx" ON "ValantAgingSnapshot"("organizationId", "asOf");
CREATE INDEX IF NOT EXISTS "ValantAgingSnapshot_clientId_idx" ON "ValantAgingSnapshot"("clientId");

CREATE TABLE IF NOT EXISTS "ValantCombinedAgingRow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "valantPatientId" TEXT,
  "party" TEXT,
  "payerName" TEXT,
  "bucket1Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket2Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket3Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket4Cents" INTEGER NOT NULL DEFAULT 0,
  "bucket5Cents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "lastBilledAt" TIMESTAMP(3),
  "rowIndex" INTEGER NOT NULL DEFAULT 0,
  "asOf" TIMESTAMP(3) NOT NULL,
  "importId" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bucketsMatchTotal" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ValantCombinedAgingRow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ValantCombinedAgingRow_organizationId_asOf_idx" ON "ValantCombinedAgingRow"("organizationId", "asOf");
CREATE INDEX IF NOT EXISTS "ValantCombinedAgingRow_clientId_idx" ON "ValantCombinedAgingRow"("clientId");

CREATE TABLE IF NOT EXISTS "ValantAgingSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "labels" JSONB,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "displayAllOver120" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "ValantAgingSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantAgingSettings_organizationId_key" ON "ValantAgingSettings"("organizationId");

CREATE TABLE IF NOT EXISTS "ValantTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "valantPatientId" TEXT,
  "billingId" TEXT,
  "serviceDate" TIMESTAMP(3),
  "providerCode" TEXT,
  "providerUserId" TEXT,
  "pos" TEXT,
  "diagnosis" TEXT,
  "code" TEXT,
  "codeBase" TEXT,
  "codeSuffix" TEXT,
  "category" TEXT,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "reportLabel" TEXT,
  "facility" TEXT,
  "insurance" TEXT,
  "sourceLayout" TEXT,
  "rowHash" TEXT NOT NULL,
  "importId" TEXT,
  CONSTRAINT "ValantTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantTransaction_organizationId_rowHash_key" ON "ValantTransaction"("organizationId", "rowHash");
CREATE INDEX IF NOT EXISTS "ValantTransaction_organizationId_serviceDate_idx" ON "ValantTransaction"("organizationId", "serviceDate");
CREATE INDEX IF NOT EXISTS "ValantTransaction_providerCode_idx" ON "ValantTransaction"("providerCode");

CREATE TABLE IF NOT EXISTS "ValantProviderMap" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "codeKey" TEXT NOT NULL,
  "providerUserId" TEXT,
  CONSTRAINT "ValantProviderMap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantProviderMap_organizationId_codeKey_key" ON "ValantProviderMap"("organizationId", "codeKey");

CREATE TABLE IF NOT EXISTS "ValantPayer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "ediPayerId" TEXT NOT NULL DEFAULT '',
  "nameVariants" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "addressLine" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,
  "addressRaw" TEXT,
  "phone" TEXT,
  "phoneRaw" TEXT,
  "phoneStatus" TEXT,
  "taxIdsRaw" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceRowHash" TEXT,
  "sourceRowCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateGroup" TEXT,
  "confirmedAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "payerRegistryId" TEXT,
  "linkedById" TEXT,
  "linkedAt" TIMESTAMP(3),
  "importId" TEXT,
  "importedAt" TIMESTAMP(3),
  CONSTRAINT "ValantPayer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantPayer_organizationId_normalizedName_ediPayerId_key" ON "ValantPayer"("organizationId", "normalizedName", "ediPayerId");
CREATE INDEX IF NOT EXISTS "ValantPayer_organizationId_active_idx" ON "ValantPayer"("organizationId", "active");

CREATE TABLE IF NOT EXISTS "ValantPayerAddress" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "payerId" TEXT NOT NULL,
  "addressKey" TEXT NOT NULL,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "addressStatus" TEXT,
  "addressIssues" TEXT,
  "phone" TEXT,
  "phonesRaw" TEXT,
  "phoneStatus" TEXT,
  "phoneIssues" TEXT,
  "taxIdsRaw" TEXT,
  "sourceLines" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ValantPayerAddress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ValantPayerAddress_payerId_addressKey_key" ON "ValantPayerAddress"("payerId", "addressKey");
CREATE INDEX IF NOT EXISTS "ValantPayerAddress_organizationId_idx" ON "ValantPayerAddress"("organizationId");

CREATE TABLE IF NOT EXISTS "IntensiveChargeDraft" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "serviceDate" DATE NOT NULL,
  "code" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 1,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "sourceKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "holdReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "priorAuthId" TEXT,
  "part2" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  CONSTRAINT "IntensiveChargeDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntensiveChargeDraft_enrollmentId_serviceDate_code_sourceKey_key" ON "IntensiveChargeDraft"("enrollmentId", "serviceDate", "code", "sourceKey");
CREATE INDEX IF NOT EXISTS "IntensiveChargeDraft_organizationId_serviceDate_idx" ON "IntensiveChargeDraft"("organizationId", "serviceDate");
CREATE INDEX IF NOT EXISTS "IntensiveChargeDraft_clientId_idx" ON "IntensiveChargeDraft"("clientId");
