-- ============================================================================
-- MIGRATION: 20261018_practice_settings.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written:
--   identifier columns (NPI, tax ID, Medicaid number, CLIA, licenses) stay NULL until a
--   practice admin enters them in Practice settings. Never seed placeholder identifiers.
-- SCOPE: practice settings (src/lib/practice, /dashboard/practice-setup, /onboarding)
--   * "PracticeSettings": one row per organization (profile, billing/claim defaults,
--     clinical policy, compliance contacts, setup-wizard progress). Typed columns.
--   * "PracticeBaa": business associate agreement status per vendor (status only).
--   * "Location": fax, service-facility NPI, default place of service, business hours.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "PracticeSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "legalName" TEXT,
  "dbaName" TEXT,
  "practiceType" TEXT,
  "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "organizationNpi" VARCHAR(10),
  "taxId" VARCHAR(9),
  "taxonomyCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "medicaidProviderNumber" TEXT,
  "medicarePtan" TEXT,
  "cliaNumber" VARCHAR(10),
  "omhcLicenseNumber" TEXT,
  "omhcLicenseExpiresOn" DATE,
  "prpLicenseNumber" TEXT,
  "prpLicenseExpiresOn" DATE,
  "accreditationBody" TEXT,
  "accreditationExpiresOn" DATE,
  "logoUrl" TEXT,
  "brandColor" TEXT,
  "mainPhone" TEXT,
  "mainFax" TEXT,
  "mainEmail" TEXT,
  "website" TEXT,
  "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
  "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
  "billingContactName" TEXT,
  "billingContactPhone" TEXT,
  "billingContactEmail" TEXT,
  "payToSameAsBilling" BOOLEAN NOT NULL DEFAULT true,
  "payToAddressLine1" TEXT,
  "payToAddressLine2" TEXT,
  "payToCity" TEXT,
  "payToState" VARCHAR(2),
  "payToZip" VARCHAR(9),
  "renderingProviderDefault" TEXT NOT NULL DEFAULT 'appointment_clinician',
  "posOffice" VARCHAR(2) NOT NULL DEFAULT '11',
  "posTelehealthHome" VARCHAR(2) NOT NULL DEFAULT '10',
  "posTelehealthOther" VARCHAR(2) NOT NULL DEFAULT '02',
  "telehealthModifierDefault" TEXT NOT NULL DEFAULT '95',
  "statementRemitName" TEXT,
  "statementRemitAddressLine1" TEXT,
  "statementRemitAddressLine2" TEXT,
  "statementRemitCity" TEXT,
  "statementRemitState" VARCHAR(2),
  "statementRemitZip" VARCHAR(9),
  "statementMessage" TEXT,
  "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
  "lateFeesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lateFeeCents" INTEGER,
  "copayCollectionPolicy" TEXT NOT NULL DEFAULT 'at_check_in',
  "noShowFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "noShowFeeCents" INTEGER,
  "lateCancelFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lateCancelFeeCents" INTEGER,
  "cancellationWindowHours" INTEGER NOT NULL DEFAULT 24,
  "noteSignDeadlineHours" INTEGER NOT NULL DEFAULT 24,
  "lateNoteEscalationHours" INTEGER NOT NULL DEFAULT 72,
  "lateNoteEscalationRole" TEXT NOT NULL DEFAULT 'PRACTICE_DIRECTOR',
  "cosignRequiredRoles" TEXT[] NOT NULL DEFAULT ARRAY['PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT']::TEXT[],
  "cosignDeadlineHours" INTEGER NOT NULL DEFAULT 72,
  "treatmentPlanReviewDays" INTEGER NOT NULL DEFAULT 180,
  "prpIrpReviewDays" INTEGER NOT NULL DEFAULT 180,
  "phq9IntervalDays" INTEGER NOT NULL DEFAULT 30,
  "gad7IntervalDays" INTEGER NOT NULL DEFAULT 30,
  "assessAtIntake" BOOLEAN NOT NULL DEFAULT true,
  "aiNoteConsentRequired" BOOLEAN NOT NULL DEFAULT true,
  "safetyPlanRequiredHighRisk" BOOLEAN NOT NULL DEFAULT true,
  "privacyOfficerName" TEXT,
  "privacyOfficerEmail" TEXT,
  "privacyOfficerPhone" TEXT,
  "securityOfficerName" TEXT,
  "securityOfficerEmail" TEXT,
  "securityOfficerPhone" TEXT,
  "breachContactName" TEXT,
  "breachContactEmail" TEXT,
  "breachContactPhone" TEXT,
  "part2Program" BOOLEAN,
  "recordRetentionYearsAdult" INTEGER NOT NULL DEFAULT 5,
  "recordRetentionMinorAge" INTEGER NOT NULL DEFAULT 21,
  "reviewedSections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "onboardingStep" TEXT,
  "onboardingCompletedAt" TIMESTAMP(3),
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PracticeSettings_organizationId_key" ON "PracticeSettings"("organizationId");

DO $$ BEGIN
  ALTER TABLE "PracticeSettings" ADD CONSTRAINT "PracticeSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PracticeBaa" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "vendorKey" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'not_started',
  "signedOn" DATE,
  "expiresOn" DATE,
  "notes" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeBaa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PracticeBaa_organizationId_vendorKey_key" ON "PracticeBaa"("organizationId", "vendorKey");

DO $$ BEGIN
  ALTER TABLE "PracticeBaa" ADD CONSTRAINT "PracticeBaa_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE IF EXISTS "Location" ADD COLUMN IF NOT EXISTS "fax" TEXT;
ALTER TABLE IF EXISTS "Location" ADD COLUMN IF NOT EXISTS "npi" VARCHAR(10);
ALTER TABLE IF EXISTS "Location" ADD COLUMN IF NOT EXISTS "posCode" VARCHAR(2);
ALTER TABLE IF EXISTS "Location" ADD COLUMN IF NOT EXISTS "businessHours" JSONB;
