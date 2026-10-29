BEGIN;
-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "availityClaimId" TEXT,
ADD COLUMN     "clearinghouseDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submissionData" JSONB,
ADD COLUMN     "submissionError" TEXT,
ADD COLUMN     "submissionInProgress" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submissionKey" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MandatoryReportRecord" ADD COLUMN     "jurisdictionState" TEXT NOT NULL DEFAULT 'MD';

-- AlterTable
ALTER TABLE "PriorAuth" ADD COLUMN     "demoMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "diagnosisCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "payerId" TEXT,
ADD COLUMN     "requestedUnits" INTEGER,
ADD COLUMN     "submissionKey" TEXT,
ADD COLUMN     "vendor" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MbcAlertAck_organizationId_assessmentId_key" ON "MbcAlertAck"("organizationId", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PriorAuth_submissionKey_key" ON "PriorAuth"("submissionKey");

COMMIT;
