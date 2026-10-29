-- CreateTable
CREATE TABLE "PatientNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientNotification_dedupeKey_key" ON "PatientNotification"("dedupeKey");
CREATE INDEX "PatientNotification_clientId_createdAt_idx" ON "PatientNotification"("clientId", "createdAt");
CREATE INDEX "PatientNotification_clientId_isRead_idx" ON "PatientNotification"("clientId", "isRead");
CREATE INDEX "PatientNotification_organizationId_clientId_idx" ON "PatientNotification"("organizationId", "clientId");
CREATE INDEX "PatientNotification_clientId_type_createdAt_idx" ON "PatientNotification"("clientId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "PatientNotification" ADD CONSTRAINT "PatientNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
