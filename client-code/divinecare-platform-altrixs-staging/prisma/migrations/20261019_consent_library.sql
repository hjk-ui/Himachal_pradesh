-- ============================================================================
-- MIGRATION: 20261019_consent_library.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Versioned consent / forms library and intake packet for the practice's Valant packet
--   (docs/source-forms/mdb-intake-form-valant-2026-10-12.md) plus industry-standard additions
--   (NPP acknowledgment, 42 CFR Part 2 consent, HIPAA ROI builder, communication / AI / recording /
--   card-on-file consents, minor consent...). Template TEXT lives in src/lib/consents/library;
--   this adds the per-practice lifecycle, packet settings, signed packets, revocation and the
--   intake data fields (SSN optional and encrypted, guardian, services interested).
-- ADDS:
--   ConsentForm: "packetId", "revokedAt", "revokedById", "revocationMethod",
--     "revocationReceivedVia", "revocationNote", "recipientName" (+ index on packetId)
--   Client: "guardianEmail", "guardianAuthority", "hasGuardian", "ssnEncrypted", "ssnLast4",
--     "servicesInterested" TEXT[] DEFAULT '{}'
--   Tables: "ConsentTemplateState", "ConsentLibrarySettings", "ConsentPacket"
-- Existing rows are untouched (all new columns nullable or defaulted). No template is approved
-- by this migration: practice-packet versions are Active by default in code; proposed ones Draft.
-- CODE: src/lib/consents/library/*, /api/consents/library/*, /dashboard/ehr/consents/library
-- ============================================================================

ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "packetId" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "revokedById" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "revocationMethod" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "revocationReceivedVia" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "revocationNote" TEXT;
ALTER TABLE "ConsentForm" ADD COLUMN IF NOT EXISTS "recipientName" TEXT;
CREATE INDEX IF NOT EXISTS "ConsentForm_packetId_idx" ON "ConsentForm" ("packetId");

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "guardianEmail" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "guardianAuthority" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "hasGuardian" BOOLEAN;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "ssnEncrypted" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "ssnLast4" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "servicesInterested" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "ConsentTemplateState" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedByName" TEXT,
  "activatedAt" TIMESTAMP(3),
  "activatedById" TEXT,
  "retiredAt" TIMESTAMP(3),
  "retiredById" TEXT,
  "note" TEXT,
  "history" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentTemplateState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConsentTemplateState_organizationId_templateKey_version_key"
  ON "ConsentTemplateState" ("organizationId", "templateKey", "version");
CREATE INDEX IF NOT EXISTS "ConsentTemplateState_organizationId_status_idx"
  ON "ConsentTemplateState" ("organizationId", "status");

CREATE TABLE IF NOT EXISTS "ConsentLibrarySettings" (
  "organizationId" TEXT NOT NULL,
  "packetKeys" TEXT[] NOT NULL DEFAULT '{}',
  "packetCustomized" BOOLEAN NOT NULL DEFAULT false,
  "nppUrl" TEXT,
  "nppFileName" TEXT,
  "nppSha256" TEXT,
  "nppEffectiveDate" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentLibrarySettings_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE IF NOT EXISTS "ConsentPacket" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "intakeInviteId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "method" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "composition" JSONB,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signedAt" TIMESTAMP(3),
  "signerType" TEXT,
  "signerName" TEXT,
  "signerRelationship" TEXT,
  "signerAuthority" TEXT,
  "signatureTyped" TEXT,
  "recordedById" TEXT,
  "pdfFileName" TEXT,
  "pdfSha256" TEXT,
  "createdById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentPacket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConsentPacket_organizationId_clientId_status_idx"
  ON "ConsentPacket" ("organizationId", "clientId", "status");
CREATE INDEX IF NOT EXISTS "ConsentPacket_organizationId_status_sentAt_idx"
  ON "ConsentPacket" ("organizationId", "status", "sentAt");
