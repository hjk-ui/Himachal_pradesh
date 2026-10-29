-- Autopay plans imported from Valant: schedule, amount, card label and reference balances.
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "planStatus" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "statusFlag" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "amountCents" INTEGER;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "upToBalance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "amountLabel" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "recurrence" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "nextChargeAt" TIMESTAMP(3);
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "cardLabel" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "cardExpiry" TEXT;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "sourceBalanceCents" INTEGER;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "sourceUnappliedCreditCents" INTEGER;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "sourcePrepaymentCents" INTEGER;
ALTER TABLE "AutopayEnrollment" ADD COLUMN IF NOT EXISTS "sourceAsOf" TIMESTAMP(3);
