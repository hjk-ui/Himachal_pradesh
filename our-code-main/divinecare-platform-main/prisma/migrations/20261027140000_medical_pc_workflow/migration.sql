-- Primary-care production tables (rooming, care gaps, referrals, MA tasks, close-loop, autopay sweep)

CREATE TABLE IF NOT EXISTS "MedicalRooming" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "identityConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "chiefComplaint" TEXT NOT NULL DEFAULT '',
    "vitals" JSONB NOT NULL,
    "allergyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "medicationReviewed" BOOLEAN NOT NULL DEFAULT false,
    "patientReportedMeds" TEXT NOT NULL DEFAULT '',
    "pharmacyReview" TEXT,
    "screenings" JSONB NOT NULL,
    "careGapActions" JSONB NOT NULL,
    "pocOrderIds" JSONB NOT NULL,
    "readyAt" TIMESTAMP(3),
    "inRoomAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalRooming_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MedicalRooming_appointmentId_key" ON "MedicalRooming"("appointmentId");
CREATE INDEX IF NOT EXISTS "MedicalRooming_organizationId_clientId_idx" ON "MedicalRooming"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "MedicalRooming_organizationId_status_idx" ON "MedicalRooming"("organizationId", "status");

ALTER TABLE "MedicalRooming"
  ADD CONSTRAINT "MedicalRooming_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalRooming"
  ADD CONSTRAINT "MedicalRooming_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalRooming"
  ADD CONSTRAINT "MedicalRooming_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MedicalCareGap" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "gapId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'due',
    "lastDoneAt" TIMESTAMP(3),
    "providerAction" TEXT,
    "maAction" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalCareGap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MedicalCareGap_organizationId_clientId_gapId_key"
  ON "MedicalCareGap"("organizationId", "clientId", "gapId");
CREATE INDEX IF NOT EXISTS "MedicalCareGap_organizationId_clientId_idx"
  ON "MedicalCareGap"("organizationId", "clientId");

ALTER TABLE "MedicalCareGap"
  ADD CONSTRAINT "MedicalCareGap_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalCareGap"
  ADD CONSTRAINT "MedicalCareGap_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MedicalReferral" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "internalBhWarmHandoff" BOOLEAN NOT NULL DEFAULT false,
    "expectedReportDays" INTEGER NOT NULL DEFAULT 30,
    "expectedReportBy" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalReferral_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MedicalReferral_organizationId_clientId_idx"
  ON "MedicalReferral"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "MedicalReferral_organizationId_status_idx"
  ON "MedicalReferral"("organizationId", "status");

ALTER TABLE "MedicalReferral"
  ADD CONSTRAINT "MedicalReferral_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalReferral"
  ADD CONSTRAINT "MedicalReferral_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MedicalMaTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToRole" TEXT NOT NULL DEFAULT 'MEDICAL_ASSISTANT',
    "appointmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalMaTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MedicalMaTask_organizationId_status_idx"
  ON "MedicalMaTask"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "MedicalMaTask_organizationId_clientId_idx"
  ON "MedicalMaTask"("organizationId", "clientId");

ALTER TABLE "MedicalMaTask"
  ADD CONSTRAINT "MedicalMaTask_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalMaTask"
  ADD CONSTRAINT "MedicalMaTask_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "CloseLoopNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "clientId" TEXT,
    "method" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL,
    "notifiedDay" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloseLoopNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CloseLoopNotification_organizationId_itemId_method_notifiedDay_key"
  ON "CloseLoopNotification"("organizationId", "itemId", "method", "notifiedDay");
CREATE INDEX IF NOT EXISTS "CloseLoopNotification_organizationId_itemId_idx"
  ON "CloseLoopNotification"("organizationId", "itemId");

ALTER TABLE "CloseLoopNotification"
  ADD CONSTRAINT "CloseLoopNotification_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CloseLoopNotification"
  ADD CONSTRAINT "CloseLoopNotification_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AutopaySweepAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopaySweepAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutopaySweepAttempt_enrollmentId_periodKey_key"
  ON "AutopaySweepAttempt"("enrollmentId", "periodKey");
CREATE INDEX IF NOT EXISTS "AutopaySweepAttempt_organizationId_periodKey_idx"
  ON "AutopaySweepAttempt"("organizationId", "periodKey");

ALTER TABLE "AutopaySweepAttempt"
  ADD CONSTRAINT "AutopaySweepAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
