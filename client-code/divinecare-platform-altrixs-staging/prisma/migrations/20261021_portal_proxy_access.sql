-- ============================================================================
-- MIGRATION: 20261021_portal_proxy_access.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: a portal login was bound to exactly one chart (PatientAccount.clientId NOT NULL, email unique),
--   so a parent with one email could not manage two children's portal accounts. Industry standard
--   (Epic MyChart proxy, athena, SimplePractice): a portal USER (login identity) separate from the
--   patient record, plus a link table saying which charts that login may open and as whom.
-- CHANGES:
--   * "PatientAccount"   is now the portal USER (login identity; email stays unique).
--                        clientId becomes NULLABLE: set = the client's own login ('self'),
--                        null = a guardian / representative-only login.
--                        + displayName, mfaMethod, mfaEnrolledAt (MFA-ready), lastActiveClientId.
--   * portal_access      portalUserId -> PatientAccount, clientId -> Client, relationship
--                        (self | parent | legal_guardian | authorized_representative), accessLevel
--                        (full | limited), grantedBy/At, verification of authority (verifiedAt/By,
--                        method, legal document ref, note), expiresAt, revokedAt/By, revokeReason,
--                        endedReason (revoked | aged_out | expired), minorAtGrant.
--   * portal_item_visibility  clinician marks a portal item confidential (hidden from every proxy)
--                        or shared_with_guardian.
--   * "Client"           + portalMinorSelfConsentMh (Md. Health-General §20-104) + who / when.
--   * "MessageThread"    + proxyPortalUserId (thread opened by a proxy: private to that proxy).
--   * "ThreadMessage"    + sentByPortalUserId (who actually sent a PATIENT message).
--   * "PatientAuditLog"  + portalAccessId, relationship (proxy audit).
-- DATA: existing PatientAccounts keep working unchanged (an account whose clientId matches the
--   session is an implicit 'self' link). Create the explicit 'self' rows with
--   scripts/migrate-portal-proxy-access.ts (dry run by default; --apply to write).
-- ============================================================================

-- ── PatientAccount → portal user ───────────────────────────────────────────
ALTER TABLE "PatientAccount" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "displayName"        TEXT;
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "mfaMethod"          TEXT;
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "mfaEnrolledAt"      TIMESTAMP(3);
ALTER TABLE "PatientAccount" ADD COLUMN IF NOT EXISTS "lastActiveClientId" TEXT;

-- ── portal_access ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_access (
  "id"                 TEXT PRIMARY KEY,
  "portalUserId"       TEXT NOT NULL,
  "clientId"           TEXT NOT NULL,
  "organizationId"     TEXT,
  "relationship"       TEXT NOT NULL,
  "accessLevel"        TEXT NOT NULL DEFAULT 'full',
  "accessLevelReason"  TEXT,
  "minorAtGrant"       BOOLEAN NOT NULL DEFAULT FALSE,
  "grantedById"        TEXT,
  "grantedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt"         TIMESTAMP(3),
  "verifiedById"       TEXT,
  "verificationMethod" TEXT,
  "legalDocumentRef"   TEXT,
  "verificationNote"   TEXT,
  "expiresAt"          TIMESTAMP(3),
  "revokedAt"          TIMESTAMP(3),
  "revokedById"        TEXT,
  "revokeReason"       TEXT,
  "endedReason"        TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_access_portalUserId_clientId_key" ON portal_access ("portalUserId", "clientId");
CREATE INDEX IF NOT EXISTS "portal_access_clientId_idx"       ON portal_access ("clientId");
CREATE INDEX IF NOT EXISTS "portal_access_organizationId_idx" ON portal_access ("organizationId");
CREATE INDEX IF NOT EXISTS "portal_access_revokedAt_idx"      ON portal_access ("revokedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_access_portalUserId_fkey') THEN
    ALTER TABLE portal_access ADD CONSTRAINT "portal_access_portalUserId_fkey"
      FOREIGN KEY ("portalUserId") REFERENCES "PatientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_access_clientId_fkey') THEN
    ALTER TABLE portal_access ADD CONSTRAINT "portal_access_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_access_relationship_check') THEN
    ALTER TABLE portal_access ADD CONSTRAINT "portal_access_relationship_check"
      CHECK ("relationship" IN ('self', 'parent', 'legal_guardian', 'authorized_representative'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_access_level_check') THEN
    ALTER TABLE portal_access ADD CONSTRAINT "portal_access_level_check"
      CHECK ("accessLevel" IN ('full', 'limited'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_access_ended_check') THEN
    ALTER TABLE portal_access ADD CONSTRAINT "portal_access_ended_check"
      CHECK ("endedReason" IS NULL OR "endedReason" IN ('revoked', 'aged_out', 'expired'));
  END IF;
  -- A proxy link is never active without a recorded verification method
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_access_verified_check') THEN
    ALTER TABLE portal_access ADD CONSTRAINT "portal_access_verified_check"
      CHECK ("verifiedAt" IS NULL OR "relationship" = 'self' OR "verificationMethod" IS NOT NULL);
  END IF;
END $$;

-- ── portal_item_visibility ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_item_visibility (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "itemType"       TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "visibility"     TEXT NOT NULL,
  "reason"         TEXT,
  "setById"        TEXT,
  "setAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "portal_item_visibility_itemType_itemId_key" ON portal_item_visibility ("itemType", "itemId");
CREATE INDEX IF NOT EXISTS "portal_item_visibility_clientId_itemType_idx" ON portal_item_visibility ("clientId", "itemType");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_item_visibility_clientId_fkey') THEN
    ALTER TABLE portal_item_visibility ADD CONSTRAINT "portal_item_visibility_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_item_visibility_value_check') THEN
    ALTER TABLE portal_item_visibility ADD CONSTRAINT "portal_item_visibility_value_check"
      CHECK ("visibility" IN ('confidential', 'shared_with_guardian'));
  END IF;
END $$;

-- ── Client: minor self-consent (Md. Health-General §20-104) ───────────────
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "portalMinorSelfConsentMh"      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "portalMinorSelfConsentSetAt"   TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "portalMinorSelfConsentSetById" TEXT;

-- ── Messages: proxy threads + real sender ─────────────────────────────────
ALTER TABLE "MessageThread" ADD COLUMN IF NOT EXISTS "proxyPortalUserId" TEXT;
CREATE INDEX IF NOT EXISTS "MessageThread_clientId_proxyPortalUserId_idx" ON "MessageThread" ("clientId", "proxyPortalUserId");
ALTER TABLE "ThreadMessage" ADD COLUMN IF NOT EXISTS "sentByPortalUserId" TEXT;

-- ── Patient audit: proxy context ───────────────────────────────────────────
ALTER TABLE "PatientAuditLog" ADD COLUMN IF NOT EXISTS "portalAccessId" TEXT;
ALTER TABLE "PatientAuditLog" ADD COLUMN IF NOT EXISTS "relationship"   TEXT;
