-- Oct 22 booked-by vias
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "createdVia" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastChangedById" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastChangedByName" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastChangedAt" TIMESTAMP(3);
