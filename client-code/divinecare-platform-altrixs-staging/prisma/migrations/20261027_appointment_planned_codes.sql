-- ============================================================================
-- MIGRATION: 20261027_appointment_planned_codes.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No rows are written.
-- WHY: staff coming from Valant choose the billing codes when they book (primary CPT/HCPCS,
--   units, modifiers 1-4, up to 3 add-ons, place of service, supervising provider, courtesy
--   discount). These are PLANNED codes only: they prefill the progress note when the provider
--   starts it, and the SIGNED NOTE's codes are what bill. Claim building never reads them.
-- ADDS:
--   * appointment_planned_codes   one row per planned line (sequence 0 = primary, 1-3 = add-ons)
--   * appointment_billing_plans   one row per appointment: POS override, supervising provider,
--                                 courtesy discount (planned; posting stays in billing)
-- NOT TOUCHED: "Appointment" gets NO new columns (it is queried without select in many places).
-- ============================================================================

CREATE TABLE IF NOT EXISTS appointment_planned_codes (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "appointmentId"  TEXT NOT NULL REFERENCES "Appointment"("id") ON DELETE CASCADE,
  "sequence"       INTEGER NOT NULL,
  "code"           VARCHAR(12) NOT NULL,
  "units"          INTEGER NOT NULL DEFAULT 1,
  "modifiers"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "chargeCents"    INTEGER,
  "overrideReason" TEXT,
  "isAddOn"        BOOLEAN NOT NULL DEFAULT FALSE,
  "createdById"    TEXT,
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT appointment_planned_codes_units_chk CHECK ("units" BETWEEN 1 AND 99),
  CONSTRAINT appointment_planned_codes_sequence_chk CHECK ("sequence" BETWEEN 0 AND 3),
  CONSTRAINT appointment_planned_codes_charge_chk CHECK ("chargeCents" IS NULL OR "chargeCents" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_planned_codes_appointmentId_sequence_key"
  ON appointment_planned_codes ("appointmentId", "sequence");
CREATE INDEX IF NOT EXISTS "appointment_planned_codes_organizationId_appointmentId_idx"
  ON appointment_planned_codes ("organizationId", "appointmentId");

CREATE TABLE IF NOT EXISTS appointment_billing_plans (
  "appointmentId"         TEXT PRIMARY KEY REFERENCES "Appointment"("id") ON DELETE CASCADE,
  "organizationId"        TEXT NOT NULL,
  "placeOfService"        VARCHAR(2),
  "supervisingProviderId" TEXT,
  "discountCents"         INTEGER,
  "discountNote"          TEXT,
  "updatedById"           TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT appointment_billing_plans_discount_chk CHECK ("discountCents" IS NULL OR "discountCents" >= 0)
);
CREATE INDEX IF NOT EXISTS "appointment_billing_plans_organizationId_idx"
  ON appointment_billing_plans ("organizationId");
