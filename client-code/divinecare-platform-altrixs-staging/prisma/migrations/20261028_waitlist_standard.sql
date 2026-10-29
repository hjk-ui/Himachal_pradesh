-- ============================================================================
-- MIGRATION: 20261028_waitlist_standard.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No existing rows are changed.
-- WHY: waitlist to industry standard (SimplePractice / Valant / TherapyNotes style): full capture
--   (split name, DOB, contact preference, guardian, service, locations, availability, payer +
--   member ID, referring provider, presenting concern, safety screen), a status pipeline with
--   close reasons, an outreach contact log with follow-up dates, and one-click conversion that
--   records the client and first appointment.
-- ADDS:
--   * "WaitlistEntry"  nullable / defaulted columns only (see list below)
--   * "WaitlistContactAttempt"  one row per outreach attempt
-- NOTE: "WaitlistEntry" is queried WITHOUT select in several places (Prisma selects every column),
--   so this migration MUST run before the code that ships with it.
-- ENUMS: "WaitlistStatus" is NOT changed. The finer pipeline lives in "stage" (TEXT):
--   NEW / CONTACTED / INTAKE_SENT / READY keep status WAITING (or MATCHED with a clinician),
--   SCHEDULED / CONVERTED keep status SCHEDULED, CLOSED keeps status CLOSED. Rows with a null
--   stage are read from their status (src/lib/waitlist/standard.ts deriveStage).
-- ============================================================================

ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "dateOfBirth" DATE;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "preferredContactMethod" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "bestTimeToContact" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "guardianName" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "guardianPhone" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "guardianRelationship" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "ageGroup" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "preferredLocationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "telehealthOk" BOOLEAN;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "availabilityDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "availabilityTimes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "clinicianGenderPref" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "languagePref" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "payerRegistryId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "insuranceMemberId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "referringProvider" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "presentingConcern" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "safetyScreen" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "safetyScreenAt" TIMESTAMP(3);
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "safetyScreenById" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "stage" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "closeReason" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "nextFollowUpAt" TIMESTAMP(3);
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "lastContactAt" TIMESTAMP(3);
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "noResponseCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "convertedAppointmentId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "marketingLeadId" TEXT;

CREATE INDEX IF NOT EXISTS "WaitlistEntry_organizationId_nextFollowUpAt_idx"
  ON "WaitlistEntry" ("organizationId", "nextFollowUpAt");

CREATE TABLE IF NOT EXISTS "WaitlistContactAttempt" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "waitlistEntryId" TEXT NOT NULL REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE,
  "method"          TEXT NOT NULL,
  "outcome"         TEXT NOT NULL,
  "note"            TEXT,
  "nextFollowUpAt"  TIMESTAMP(3),
  "createdById"     TEXT,
  "createdByName"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WaitlistContactAttempt_waitlistEntryId_createdAt_idx"
  ON "WaitlistContactAttempt" ("waitlistEntryId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaitlistContactAttempt_organizationId_createdAt_idx"
  ON "WaitlistContactAttempt" ("organizationId", "createdAt");
