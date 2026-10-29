-- Visit Guide checklist persistence (Oct 21 staging parity)
CREATE TABLE IF NOT EXISTS "VisitChecklistItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitKind" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VisitChecklistItem_organizationId_clientId_visitKind_idx"
  ON "VisitChecklistItem"("organizationId", "clientId", "visitKind");

CREATE INDEX IF NOT EXISTS "VisitChecklistItem_appointmentId_idx"
  ON "VisitChecklistItem"("appointmentId");

CREATE INDEX IF NOT EXISTS "VisitChecklistItem_clientId_stepKey_idx"
  ON "VisitChecklistItem"("clientId", "stepKey");

ALTER TABLE "VisitChecklistItem"
  ADD CONSTRAINT "VisitChecklistItem_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitChecklistItem"
  ADD CONSTRAINT "VisitChecklistItem_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitChecklistItem"
  ADD CONSTRAINT "VisitChecklistItem_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
