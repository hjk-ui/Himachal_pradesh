-- ============================================================================
-- MIGRATION: 20261021_patient_autopay.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- SCOPE: Real patient automatic payments (card on file through Stripe Elements / SetupIntent,
--   off-session PaymentIntents). src/lib/patientPayments
--   * PatientPaymentSettings  per-practice master switch (DEFAULT OFF), charge rules, caps,
--                             statement descriptor suffix, receipt sender, optional Connect account
--   * PatientStripeCustomer   Stripe customer per patient account (test / live kept apart)
--   * PatientCharge           one row per charge decision (idempotency key = visit / ERA + type)
--   * PatientChargeRefund     staff refunds / voids through Stripe
--   * CardOnFile              livemode, capturedVia, capturedById, setupIntentId
-- No card numbers, CVVs or PHI are stored: only Stripe ids, brand, last 4 and expiry.
-- Nothing is backfilled. Apply BEFORE deploying the code that reads these tables.
-- ============================================================================

ALTER TABLE "CardOnFile" ADD COLUMN IF NOT EXISTS "livemode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CardOnFile" ADD COLUMN IF NOT EXISTS "capturedVia" TEXT;
ALTER TABLE "CardOnFile" ADD COLUMN IF NOT EXISTS "capturedById" TEXT;
ALTER TABLE "CardOnFile" ADD COLUMN IF NOT EXISTS "setupIntentId" TEXT;

CREATE TABLE IF NOT EXISTS "PatientPaymentSettings" (
  "organizationId"            TEXT         NOT NULL,
  "enabled"                   BOOLEAN      NOT NULL DEFAULT false,
  "chargeCopays"              BOOLEAN      NOT NULL DEFAULT true,
  "chargeAfterEra"            BOOLEAN      NOT NULL DEFAULT true,
  "chargeSelfPay"             BOOLEAN      NOT NULL DEFAULT true,
  "chargeMissedVisitFees"     BOOLEAN      NOT NULL DEFAULT false,
  "maxPerChargeCents"         INTEGER,
  "maxPerMonthCents"          INTEGER,
  "statementDescriptorSuffix" VARCHAR(10),
  "receiptSenderName"         VARCHAR(60),
  "stripeAccountId"           TEXT,
  "updatedById"               TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientPaymentSettings_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE IF NOT EXISTS "PatientStripeCustomer" (
  "id"               TEXT         NOT NULL,
  "organizationId"   TEXT         NOT NULL,
  "clientId"         TEXT         NOT NULL,
  "stripeCustomerId" TEXT         NOT NULL,
  "livemode"         BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientStripeCustomer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PatientStripeCustomer_stripeCustomerId_key" ON "PatientStripeCustomer" ("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "PatientStripeCustomer_organizationId_clientId_livemode_key" ON "PatientStripeCustomer" ("organizationId", "clientId", "livemode");

CREATE TABLE IF NOT EXISTS "PatientCharge" (
  "id"                    TEXT         NOT NULL,
  "organizationId"        TEXT         NOT NULL,
  "clientId"              TEXT         NOT NULL,
  "kind"                  TEXT         NOT NULL,
  "status"                TEXT         NOT NULL,
  "amountCents"           INTEGER      NOT NULL,
  "idempotencyKey"        TEXT         NOT NULL,
  "appointmentId"         TEXT,
  "claimId"               TEXT,
  "eraClaimId"            TEXT,
  "chargeMonth"           VARCHAR(7)   NOT NULL,
  "reason"                TEXT,
  "cardOnFileId"          TEXT,
  "cardBrand"             TEXT,
  "cardLast4"             VARCHAR(4),
  "stripePaymentIntentId" TEXT,
  "livemode"              BOOLEAN      NOT NULL DEFAULT false,
  "attempts"              INTEGER      NOT NULL DEFAULT 0,
  "lastAttemptAt"         TIMESTAMP(3),
  "failureCode"           TEXT,
  "failureMessage"        TEXT,
  "paymentId"             TEXT,
  "refundedCents"         INTEGER      NOT NULL DEFAULT 0,
  "receiptNumber"         TEXT,
  "receiptEmailedAt"      TIMESTAMP(3),
  "patientNotifiedAt"     TIMESTAMP(3),
  "succeededAt"           TIMESTAMP(3),
  "createdById"           TEXT,
  "updatedById"           TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PatientCharge_organizationId_idempotencyKey_key" ON "PatientCharge" ("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PatientCharge_stripePaymentIntentId_key" ON "PatientCharge" ("stripePaymentIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PatientCharge_receiptNumber_key" ON "PatientCharge" ("receiptNumber");
CREATE INDEX IF NOT EXISTS "PatientCharge_organizationId_status_createdAt_idx" ON "PatientCharge" ("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PatientCharge_organizationId_chargeMonth_idx" ON "PatientCharge" ("organizationId", "chargeMonth");
CREATE INDEX IF NOT EXISTS "PatientCharge_clientId_createdAt_idx" ON "PatientCharge" ("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "PatientCharge_appointmentId_idx" ON "PatientCharge" ("appointmentId");
CREATE INDEX IF NOT EXISTS "PatientCharge_claimId_idx" ON "PatientCharge" ("claimId");

CREATE TABLE IF NOT EXISTS "PatientChargeRefund" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "chargeId"       TEXT         NOT NULL,
  "amountCents"    INTEGER      NOT NULL,
  "kind"           TEXT         NOT NULL DEFAULT 'refund',
  "status"         TEXT         NOT NULL,
  "stripeRefundId" TEXT,
  "reason"         TEXT,
  "paymentId"      TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientChargeRefund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PatientChargeRefund_stripeRefundId_key" ON "PatientChargeRefund" ("stripeRefundId");
CREATE INDEX IF NOT EXISTS "PatientChargeRefund_chargeId_idx" ON "PatientChargeRefund" ("chargeId");
CREATE INDEX IF NOT EXISTS "PatientChargeRefund_organizationId_createdAt_idx" ON "PatientChargeRefund" ("organizationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientChargeRefund_chargeId_fkey') THEN
    ALTER TABLE "PatientChargeRefund"
      ADD CONSTRAINT "PatientChargeRefund_chargeId_fkey" FOREIGN KEY ("chargeId")
      REFERENCES "PatientCharge" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
