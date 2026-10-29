-- ============================================================================
-- MIGRATION: 20261019_scheduling_fixes.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written
--   (every new column is nullable or has a false default; no backfill).
-- SCOPE:
--   * "AppointmentSeries" + "Appointment"."seriesId": recurring appointments.
--   * "Appointment": audioOnly, confirmedAt (reply C), overbookReason (intentional overbook),
--     patientLocationType / patientLocationState (telehealth POS 10 / 02).
--   * "TelehealthSession": patientLocationType (home | other), audioOnly.
--   * "Client": TCPA SMS consent (smsConsent, smsConsentAt, smsConsentSource, smsOptOutAt),
--     emailOptOutAt, online-booking identity review (identityVerifyRequired,
--     identityVerifyReason, unverifiedEmail).
--   * "NotificationLog": appointmentId, channel, status, reason (per-appointment reminder log).
--   * "SmsInboundEvent": inbound STOP / UNSTOP / HELP / C keywords (opt-out evidence).
-- NOTE: existing clients get smsConsent = false. SMS reminders stay off for a client until
--   consent is recorded (intake, portal, or staff with source). Do not bulk-set consent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "AppointmentSeries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clinicianId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "byWeekday" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "count" INTEGER,
  "startTime" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "isVirtual" BOOLEAN NOT NULL DEFAULT false,
  "audioOnly" BOOLEAN NOT NULL DEFAULT false,
  "labelId" TEXT,
  "location" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentSeries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AppointmentSeries_organizationId_clientId_idx" ON "AppointmentSeries"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "AppointmentSeries_organizationId_clinicianId_idx" ON "AppointmentSeries"("organizationId", "clinicianId");

DO $$ BEGIN
  ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_frequency_check"
    CHECK ("frequency" IN ('weekly', 'biweekly', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AppointmentSeries" ADD CONSTRAINT "AppointmentSeries_count_check"
    CHECK ("count" IS NULL OR ("count" >= 1 AND "count" <= 26));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "seriesId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "audioOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "overbookReason" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "patientLocationType" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "patientLocationState" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_seriesId_startsAt_idx" ON "Appointment"("seriesId", "startsAt");
DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "AppointmentSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientLocationType_check"
    CHECK ("patientLocationType" IS NULL OR "patientLocationType" IN ('home', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "TelehealthSession" ADD COLUMN IF NOT EXISTS "patientLocationType" TEXT;
ALTER TABLE "TelehealthSession" ADD COLUMN IF NOT EXISTS "audioOnly" BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_patientLocationType_check"
    CHECK ("patientLocationType" IS NULL OR "patientLocationType" IN ('home', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "smsConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "smsConsentAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "smsConsentSource" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "smsOptOutAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "emailOptOutAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "identityVerifyRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "identityVerifyReason" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "unverifiedEmail" TEXT;

ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN IF NOT EXISTS "reason" TEXT;
CREATE INDEX IF NOT EXISTS "NotificationLog_appointmentId_idx" ON "NotificationLog"("appointmentId");

CREATE TABLE IF NOT EXISTS "SmsInboundEvent" (
  "id" TEXT NOT NULL,
  "snsMessageId" TEXT NOT NULL,
  "fromNumber" TEXT NOT NULL,
  "keyword" TEXT NOT NULL,
  "clientIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "appointmentId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsInboundEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SmsInboundEvent_snsMessageId_key" ON "SmsInboundEvent"("snsMessageId");
CREATE INDEX IF NOT EXISTS "SmsInboundEvent_fromNumber_receivedAt_idx" ON "SmsInboundEvent"("fromNumber", "receivedAt");

-- Telehealth billing draft POS: no guessed default. Null = patient location not captured.
DO $$ BEGIN
  ALTER TABLE "TelehealthBillingDraft" ALTER COLUMN "posCode" DROP DEFAULT;
  ALTER TABLE "TelehealthBillingDraft" ALTER COLUMN "posCode" DROP NOT NULL;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END $$;
