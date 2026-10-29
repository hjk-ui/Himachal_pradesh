-- ============================================================================
-- MIGRATION: 20261016_waystar_outbound_complete.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- SCOPE: Waystar outbound 837P (005010X222A1):
--   * Claim: <=20-char CLM01 control number, payer responsibility (SBR01),
--     claim frequency (CLM05-3), payer claim control number (REF*F8), link to
--     the primary claim for secondary/tertiary billing
--   * claim_control_numbers: every CLM01 a claim was sent under (277CA / 835 matching)
--   * client_insurance_coverages: subscriber != patient, secondary/tertiary policies
--   * waystar_payer_mappings: payer name/aliases -> Waystar payer ID
--   * billing_providers: the practice's three organization NPIs (2010AA)
-- ============================================================================

-- 1. Claim columns -----------------------------------------------------------
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "claimControlNumber" TEXT;
ALTER TABLE "Claim" ALTER COLUMN "claimControlNumber"
  SET DEFAULT ('AX'::text || upper(substr(md5((random())::text || (clock_timestamp())::text), 1, 16)));
-- Backfill existing claims (one number each; the unique index below catches a collision)
UPDATE "Claim"
   SET "claimControlNumber" = 'AX' || upper(substr(md5(id || (random())::text || (clock_timestamp())::text), 1, 16))
 WHERE "claimControlNumber" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Claim_claimControlNumber_key" ON "Claim"("claimControlNumber");

ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "payerResponsibility" TEXT NOT NULL DEFAULT 'P';
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "frequencyCode" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "payerClaimControlNumber" TEXT;
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "primaryClaimId" TEXT;
CREATE INDEX IF NOT EXISTS "Claim_primaryClaimId_idx" ON "Claim"("primaryClaimId");

DO $$ BEGIN
  ALTER TABLE "Claim" ADD CONSTRAINT "Claim_payerResponsibility_check" CHECK ("payerResponsibility" IN ('P', 'S', 'T'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Claim" ADD CONSTRAINT "Claim_frequencyCode_check" CHECK ("frequencyCode" IN ('1', '7', '8'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. CLM01 history -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_control_numbers (
    control_number VARCHAR(20) PRIMARY KEY,
    claim_id TEXT NOT NULL,
    frequency_code VARCHAR(1) NOT NULL DEFAULT '1',
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS claim_control_numbers_claim_id_idx ON claim_control_numbers(claim_id);
DO $$ BEGIN
  ALTER TABLE claim_control_numbers ADD CONSTRAINT claim_control_numbers_claim_id_fkey
    FOREIGN KEY (claim_id) REFERENCES "Claim"(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
INSERT INTO claim_control_numbers (control_number, claim_id, frequency_code)
SELECT "claimControlNumber", id, "frequencyCode" FROM "Claim" WHERE "claimControlNumber" IS NOT NULL
ON CONFLICT (control_number) DO NOTHING;

-- 3. Client insurance coverages ---------------------------------------------
CREATE TABLE IF NOT EXISTS client_insurance_coverages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    rank VARCHAR(1) NOT NULL CHECK (rank IN ('P', 'S', 'T')),
    payer_name TEXT,
    member_id TEXT,
    group_number TEXT,
    claim_filing_code VARCHAR(2),
    subscriber_relationship VARCHAR(2) NOT NULL DEFAULT '18'
      CHECK (subscriber_relationship IN ('18', '01', '19', '20', '21', '39', '40', '53', 'G8')),
    subscriber_first_name TEXT,
    subscriber_last_name TEXT,
    subscriber_middle_initial VARCHAR(1),
    subscriber_dob DATE,
    subscriber_gender VARCHAR(1) CHECK (subscriber_gender IS NULL OR subscriber_gender IN ('M', 'F', 'U')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_insurance_coverages_client_id_rank_key ON client_insurance_coverages(client_id, rank);
CREATE INDEX IF NOT EXISTS client_insurance_coverages_organization_id_idx ON client_insurance_coverages(organization_id);

-- 4. Waystar payer mapping ---------------------------------------------------
-- organization_id '*' = applies to every organization on this deployment.
CREATE TABLE IF NOT EXISTS waystar_payer_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL DEFAULT '*',
    payer_name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    waystar_payer_id VARCHAR(15) NOT NULL,
    claim_filing_code VARCHAR(2) NOT NULL,
    telehealth_modifier VARCHAR(4) NOT NULL DEFAULT '95' CHECK (telehealth_modifier IN ('95', 'GT', 'both', 'none')),
    requires_prior_auth BOOLEAN NOT NULL DEFAULT FALSE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS waystar_payer_mappings_organization_id_payer_name_key
  ON waystar_payer_mappings(organization_id, payer_name);

-- Only payer ID known in the repo/notes. It is UNVERIFIED (not yet confirmed on
-- Waystar's payer list), so it is seeded with verified = FALSE: test (ISA15=T)
-- sends may use it, production (ISA15=P) sends are blocked until a billing admin
-- confirms it. NOTE: Maryland Medicaid behavioral-health claims route to the
-- Optum Maryland ASO, which may have its own Waystar payer ID.
INSERT INTO waystar_payer_mappings (organization_id, payer_name, aliases, waystar_payer_id, claim_filing_code, verified, notes)
VALUES ('*', 'Maryland Medicaid', ARRAY['MD Medicaid', 'Maryland Medical Assistance'], '100198', 'MC', FALSE,
        'UNVERIFIED: used on the first Waystar test claim (Oct 15 2026). Confirm on Waystar''s payer list before production.')
ON CONFLICT (organization_id, payer_name) DO NOTHING;

-- 5. Billing providers (2010AA) ---------------------------------------------
CREATE TABLE IF NOT EXISTS billing_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL DEFAULT '*',
    npi VARCHAR(10) NOT NULL,
    name TEXT NOT NULL,
    label TEXT,
    tax_id VARCHAR(9) NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state VARCHAR(2) NOT NULL,
    zip VARCHAR(9) NOT NULL,
    phone VARCHAR(10),
    departments TEXT[] NOT NULL DEFAULT '{}',
    clinician_roles TEXT[] NOT NULL DEFAULT '{}',
    location_keys TEXT[] NOT NULL DEFAULT '{}',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_providers_organization_id_npi_key ON billing_providers(organization_id, npi);

-- MD Behavioral Health LLC, tax ID 923843658: three organization (Type 2) NPIs,
-- each with its NPPES address. Rules (departments / clinician roles / locations)
-- are starting points for admins to adjust in Billing > Payer settings.
INSERT INTO billing_providers (organization_id, npi, name, label, tax_id, address_line1, address_line2, city, state, zip, phone, departments, clinician_roles, is_default)
VALUES
  ('*', '1801621297', 'MD BEHAVIORAL HEALTH LLC', 'Adult Mental Health Clinic', '923843658', '4000 MITCHELLVILLE RD', 'STE 414',  'BOWIE',       'MD', '207163104', '3012498100', ARRAY['mental_health'],     ARRAY[]::TEXT[],                    TRUE),
  ('*', '1346021813', 'MD BEHAVIORAL HEALTH LLC', 'Psychiatry',                 '923843658', '4000 MITCHELLVILLE RD', 'STE A414', 'BOWIE',       'MD', '207163142', '3012498100', ARRAY['psychiatry'],        ARRAY['PSYCHIATRIST', 'NP'],        FALSE),
  ('*', '1740059005', 'MD BEHAVIORAL HEALTH LLC', 'Internal Medicine',          '923843658', '7610 CARROLL AVE',      'STE 360',  'TAKOMA PARK', 'MD', '209126323', '3012498100', ARRAY['internal_medicine'], ARRAY['PHYSICIAN', 'MEDICAL_NP'],  FALSE)
ON CONFLICT (organization_id, npi) DO NOTHING;
