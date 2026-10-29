-- Oct 24 Valant appointment history import (source = valant_history; never a live schedule slot)
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "externalKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_organizationId_externalKey_key" ON "Appointment"("organizationId", "externalKey");
CREATE INDEX IF NOT EXISTS "Appointment_organizationId_source_idx" ON "Appointment"("organizationId", "source");
