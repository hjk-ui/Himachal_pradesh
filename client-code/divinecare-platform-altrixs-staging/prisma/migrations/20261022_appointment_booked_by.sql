-- ============================================================================
-- MIGRATION: 20261022_appointment_booked_by.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: show who put a client on the schedule and who last changed the visit
--   ("Booked by ... / Last changed by ..." in the appointment details).
--   createdVia: staff | online (public booking page) | portal (client portal) | group | import.
-- BACKFILL (only rows still NULL):
--   * staff bookings with a HIPAA audit CREATE entry -> that staff member
--   * patientBooked rows -> online
--   * rows created by the Valant import on staging (no audit entry, created before 2026-10-17) -> import
-- ============================================================================

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "createdVia" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastChangedById" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastChangedByName" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastChangedAt" TIMESTAMP(3);

UPDATE "Appointment" a
SET "createdById" = l."actorUserId",
    "createdByName" = u.name,
    "createdVia" = 'staff'
FROM "AuditLog" l
LEFT JOIN "User" u ON u.id = l."actorUserId"
WHERE a."createdVia" IS NULL
  AND l."resourceType" = 'appointment'
  AND l.action = 'CREATE'
  AND l.outcome = 'SUCCESS'
  AND l."resourceId" = a.id;

UPDATE "Appointment" SET "createdVia" = 'online' WHERE "createdVia" IS NULL AND "patientBooked" = true;

UPDATE "Appointment" SET "createdVia" = 'group' WHERE "createdVia" IS NULL AND "groupSessionId" IS NOT NULL;

UPDATE "Appointment" SET "createdVia" = 'import' WHERE "createdVia" IS NULL AND "createdAt" < TIMESTAMP '2026-10-17 00:00:00';
