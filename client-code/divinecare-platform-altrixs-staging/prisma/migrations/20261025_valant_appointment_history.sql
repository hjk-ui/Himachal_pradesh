-- ============================================================================
-- MIGRATION: 20261025_valant_appointment_history.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Import Valant's historical appointments ("Biller Appointments" report) so client "Last seen",
--   session cadence and behavioral care-team links work from go-live day.
--   * "Appointment"."source": 'valant_history' for imported history; NULL = booked in Altrixs.
--     Imported rows are excluded from the missing-note queue / tasks, the documentation-rate trend,
--     the unbilled-encounters report and the AutoPay visit sweep (notes and billing live in Valant).
--   * "Appointment"."externalKey": stable hash of chart id + date + start time + provider, unique per
--     organization, so re-running the import (createMany skipDuplicates) never duplicates a visit.
-- Run this BEFORE deploying code built from the matching prisma/schema.prisma (Prisma selects the
-- new columns on every Appointment read).
-- ============================================================================

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "externalKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_organizationId_externalKey_key"
  ON "Appointment" ("organizationId", "externalKey");
