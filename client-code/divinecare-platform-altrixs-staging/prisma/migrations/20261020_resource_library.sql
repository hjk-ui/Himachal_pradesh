-- ============================================================================
-- MIGRATION: 20261020_resource_library.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No content rows are written.
-- WHY: /dashboard/resources kept practice uploads and client assignments in two org-wide JSON
--   blobs (ClinicModuleState 'resource-uploads' / 'resource-assignments'): client names inside,
--   no caseload scoping, reads not audited, nothing ever reached the patient portal, and the
--   page's 12 built-in "handouts" had no file or link behind them.
-- ADDS:
--   * resource_items        content library (patient-facing and staff resources): handout /
--                           worksheet upload, external link, video link, text article, crisis
--                           resource, community resource. Metadata: topics, audiences, language,
--                           reading level, publisher, license note, link check, clinical review,
--                           status draft | active | retired. Staff items carry role visibility.
--   * resource_user_state   per-user favorites and "recently used".
--   * resource_assignments  a resource sent to one client: message, due date, status
--                           sent | viewed | completed | withdrawn, context (library / chart /
--                           note / scribe / sdoh / legacy), 42 CFR Part 2 flag, notification result.
--   * sdoh_resources        + counties (service area), email, verification source / verifier.
--   * sdoh_referrals        + referralType (resource_given | referral_made), followUpDate,
--                           followUpCompletedAt, libraryItemId (closes the SDOH loop).
-- NOT TOUCHED: the old blobs stay in ClinicModuleState (read-only). Copy them with
--   scripts/migrate-resource-library-blob.ts (dry run by default).
-- ============================================================================

CREATE TABLE IF NOT EXISTS resource_items (
  "id"                  TEXT PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "audience"            TEXT NOT NULL DEFAULT 'patient',
  "kind"                TEXT NOT NULL,
  "title"               TEXT NOT NULL,
  "summary"             TEXT,
  "body"                TEXT,
  "url"                 TEXT,
  "contactPhone"        TEXT,
  "contactText"         TEXT,
  "fileStoredName"      TEXT,
  "fileName"            TEXT,
  "fileMime"            TEXT,
  "fileSize"            INTEGER,
  "topics"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "audiences"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "language"            TEXT NOT NULL DEFAULT 'en',
  "readingLevel"        TEXT,
  "publisher"           TEXT,
  "licenseNote"         TEXT,
  "linkCheckedAt"       TIMESTAMP(3),
  "lastReviewedAt"      TIMESTAMP(3),
  "reviewedById"        TEXT,
  "reviewerName"        TEXT,
  "status"              TEXT NOT NULL DEFAULT 'draft',
  "staffCategory"       TEXT,
  "visibleRoles"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sudRelated"          BOOLEAN NOT NULL DEFAULT FALSE,
  "communityResourceId" TEXT,
  "seedKey"             TEXT,
  "legacySourceId"      TEXT,
  "createdById"         TEXT,
  "updatedById"         TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "resource_items_organizationId_audience_status_idx"
  ON resource_items ("organizationId", "audience", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_items_organizationId_seedKey_key"
  ON resource_items ("organizationId", "seedKey");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_items_organizationId_legacySourceId_key"
  ON resource_items ("organizationId", "legacySourceId");

DO $$ BEGIN
  ALTER TABLE resource_items ADD CONSTRAINT "resource_items_audience_check" CHECK ("audience" IN ('patient', 'staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE resource_items ADD CONSTRAINT "resource_items_kind_check"
    CHECK ("kind" IN ('handout', 'link', 'video', 'article', 'crisis', 'community'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE resource_items ADD CONSTRAINT "resource_items_status_check" CHECK ("status" IN ('draft', 'active', 'retired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE resource_items ADD CONSTRAINT "resource_items_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS resource_user_state (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "itemId"         TEXT NOT NULL REFERENCES resource_items("id") ON DELETE CASCADE,
  "favorite"       BOOLEAN NOT NULL DEFAULT FALSE,
  "lastUsedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "resource_user_state_userId_itemId_key" ON resource_user_state ("userId", "itemId");
CREATE INDEX IF NOT EXISTS "resource_user_state_organizationId_userId_idx" ON resource_user_state ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS resource_assignments (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "itemId"             TEXT NOT NULL REFERENCES resource_items("id") ON DELETE RESTRICT,
  "clientId"           TEXT NOT NULL,
  "assignedById"       TEXT,
  "assignedByName"     TEXT,
  "message"            TEXT,
  "dueDate"            DATE,
  "status"             TEXT NOT NULL DEFAULT 'sent',
  "sentAt"             TIMESTAMP(3),
  "viewedAt"           TIMESTAMP(3),
  "completedAt"        TIMESTAMP(3),
  "withdrawnAt"        TIMESTAMP(3),
  "withdrawnById"      TEXT,
  "withdrawnReason"    TEXT,
  "context"            TEXT NOT NULL DEFAULT 'library',
  "contextId"          TEXT,
  "part2"              BOOLEAN NOT NULL DEFAULT FALSE,
  "notificationStatus" TEXT,
  "notificationReason" TEXT,
  "legacySourceId"     TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "resource_assignments_organizationId_clientId_idx" ON resource_assignments ("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "resource_assignments_organizationId_assignedById_idx" ON resource_assignments ("organizationId", "assignedById");
CREATE INDEX IF NOT EXISTS "resource_assignments_organizationId_createdAt_idx" ON resource_assignments ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "resource_assignments_itemId_idx" ON resource_assignments ("itemId");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_assignments_organizationId_legacySourceId_key"
  ON resource_assignments ("organizationId", "legacySourceId");

DO $$ BEGIN
  ALTER TABLE resource_assignments ADD CONSTRAINT "resource_assignments_status_check"
    CHECK ("status" IN ('sent', 'viewed', 'completed', 'withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE resource_assignments ADD CONSTRAINT "resource_assignments_context_check"
    CHECK ("context" IN ('library', 'chart', 'note', 'scribe', 'sdoh', 'legacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE resource_assignments ADD CONSTRAINT "resource_assignments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE resource_assignments ADD CONSTRAINT "resource_assignments_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Community directory (SDOH) additions
ALTER TABLE sdoh_resources ADD COLUMN IF NOT EXISTS "counties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE sdoh_resources ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE sdoh_resources ADD COLUMN IF NOT EXISTS "verificationSource" TEXT;
ALTER TABLE sdoh_resources ADD COLUMN IF NOT EXISTS "verifiedById" TEXT;

-- SDOH referral loop additions
ALTER TABLE sdoh_referrals ADD COLUMN IF NOT EXISTS "referralType" TEXT NOT NULL DEFAULT 'referral_made';
ALTER TABLE sdoh_referrals ADD COLUMN IF NOT EXISTS "followUpDate" DATE;
ALTER TABLE sdoh_referrals ADD COLUMN IF NOT EXISTS "followUpCompletedAt" TIMESTAMP(3);
ALTER TABLE sdoh_referrals ADD COLUMN IF NOT EXISTS "libraryItemId" TEXT;
DO $$ BEGIN
  ALTER TABLE sdoh_referrals ADD CONSTRAINT "sdoh_referrals_referralType_check"
    CHECK ("referralType" IN ('resource_given', 'referral_made'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "sdoh_referrals_organizationId_followUpDate_idx" ON sdoh_referrals ("organizationId", "followUpDate");
