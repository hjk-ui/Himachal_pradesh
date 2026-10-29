-- ============================================================================
-- MIGRATION: 20261018_appointment_labels.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written:
--   the 12 Valant labels are created only when a practice admin clicks
--   "Load Valant labels" in Admin > Scheduling settings (src/lib/scheduling/appointmentLabelsServer.ts).
-- SCOPE: calendar color labels (Valant "appointment labels")
--   * "AppointmentLabel": per-organization label (name, display name, hex color,
--     availability free|busy|tentative, sort order, active, source valant|altrixs,
--     optional meaning key used for suggestions).
--   * "AppointmentLabelSettings": per-organization "auto-apply suggested labels" (default OFF).
--   * "Appointment"."labelId": nullable FK, ON DELETE SET NULL. Like "location_id", it is
--     NOT in the Prisma model: the app reads/writes it with raw SQL after checking the
--     column exists, so the calendar keeps working where this migration has not run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "AppointmentLabel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "color" VARCHAR(7) NOT NULL,
  "availability" TEXT NOT NULL DEFAULT 'free',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'altrixs',
  "meaning" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentLabel_organizationId_name_key" ON "AppointmentLabel"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "AppointmentLabel_organizationId_active_sortOrder_idx" ON "AppointmentLabel"("organizationId", "active", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "AppointmentLabel" ADD CONSTRAINT "AppointmentLabel_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AppointmentLabel" ADD CONSTRAINT "AppointmentLabel_availability_check"
    CHECK ("availability" IN ('free', 'busy', 'tentative'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AppointmentLabel" ADD CONSTRAINT "AppointmentLabel_source_check"
    CHECK ("source" IN ('valant', 'altrixs'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AppointmentLabel" ADD CONSTRAINT "AppointmentLabel_color_check"
    CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AppointmentLabelSettings" (
  "organizationId" TEXT NOT NULL,
  "autoApplySuggested" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentLabelSettings_pkey" PRIMARY KEY ("organizationId")
);

DO $$ BEGIN
  ALTER TABLE "AppointmentLabelSettings" ADD CONSTRAINT "AppointmentLabelSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE IF EXISTS "Appointment" ADD COLUMN IF NOT EXISTS "labelId" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_labelId_idx" ON "Appointment"("labelId");

DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_labelId_fkey"
    FOREIGN KEY ("labelId") REFERENCES "AppointmentLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
