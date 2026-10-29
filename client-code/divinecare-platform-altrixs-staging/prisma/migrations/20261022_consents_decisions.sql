-- ============================================================================
-- MIGRATION: 20261022_consents_decisions.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: consent decisions made to the industry standard (owner delegated):
--   * Check-in soft stop: staff may check a client in without the consent to treatment (or the
--     telehealth consent for a virtual visit) only with a written reason. The reason is stored
--     here, not in the audit log metadata (audit action CONSENT_CHECKIN_OVERRIDE carries ids only).
--   * Automatic consent reminders (scripts/consent-reminders.ts): unsigned packets at 3 and 7 days,
--     renewals 30 and 7 days before expiry, at most 3 per packet / consent. One tracker row per
--     subject so nothing is sent twice.
--   * Practice toggle "Automatic consent reminders" (default ON).
-- See src/lib/consents/library/decisions.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ConsentCheckInOverride" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "appointmentId"  TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "templateKeys"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reason"         TEXT NOT NULL,
  "overriddenById" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentCheckInOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConsentCheckInOverride_organizationId_createdAt_idx" ON "ConsentCheckInOverride" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConsentCheckInOverride_appointmentId_idx" ON "ConsentCheckInOverride" ("appointmentId");
CREATE INDEX IF NOT EXISTS "ConsentCheckInOverride_clientId_idx" ON "ConsentCheckInOverride" ("clientId");

CREATE TABLE IF NOT EXISTS "ConsentReminder" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "subjectId"      TEXT NOT NULL,
  "count"          INTEGER NOT NULL DEFAULT 0,
  "lastAt"         TIMESTAMP(3),
  "stages"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentReminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConsentReminder_kind_subjectId_key" ON "ConsentReminder" ("kind", "subjectId");
CREATE INDEX IF NOT EXISTS "ConsentReminder_organizationId_kind_idx" ON "ConsentReminder" ("organizationId", "kind");

CREATE TABLE IF NOT EXISTS "ConsentReminderSettings" (
  "organizationId" TEXT NOT NULL,
  "autoReminders"  BOOLEAN NOT NULL DEFAULT true,
  "updatedById"    TEXT,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentReminderSettings_pkey" PRIMARY KEY ("organizationId")
);
