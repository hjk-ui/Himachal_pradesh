-- ============================================================================
-- MIGRATION: 20261026_baa_acceptance.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Click-through Business Associate Agreement acceptance at registration and by admins of
--   existing organizations (src/lib/legal/baa.ts, src/lib/legal/baaAcceptance.ts). One row per
--   acceptance with signer name / title / email, BAA version, SHA-256 of the accepted text,
--   time, IP and user agent. Rows are never updated or deleted by the app.
-- Run BEFORE deploying the matching code (registration writes this table).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "BaaAcceptance" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "signerName"     TEXT NOT NULL,
  "signerTitle"    TEXT NOT NULL,
  "signerEmail"    TEXT NOT NULL,
  "baaVersion"     TEXT NOT NULL,
  "textSha256"     TEXT NOT NULL,
  "acceptedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "source"         TEXT NOT NULL DEFAULT 'registration',
  CONSTRAINT "BaaAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BaaAcceptance_organizationId_acceptedAt_idx"
  ON "BaaAcceptance" ("organizationId", "acceptedAt");
CREATE INDEX IF NOT EXISTS "BaaAcceptance_organizationId_baaVersion_idx"
  ON "BaaAcceptance" ("organizationId", "baaVersion");
