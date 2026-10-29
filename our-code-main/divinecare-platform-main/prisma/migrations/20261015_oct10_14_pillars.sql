-- ============================================================================
-- OCT 10 - 14, 2026 SYSTEM EVOLUTION POSTGRESQL DDL MIGRATION
-- PLATFORM: Altrixs / MD Behavioral Health
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1.1 Practices & Multi-Locations
CREATE TABLE IF NOT EXISTS practices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255) NOT NULL,
    platform_name VARCHAR(100) DEFAULT 'Altrixs',
    group_npi VARCHAR(10) NOT NULL CHECK (length(group_npi) = 10),
    tax_id VARCHAR(20) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    main_phone VARCHAR(20),
    main_email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    address_line1 VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    zip_code VARCHAR(10) NOT NULL,
    location_npi VARCHAR(10) CHECK (length(location_npi) = 10),
    is_flagship BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed MD Behavioral Health Practice & Locations if not present
INSERT INTO practices (id, name, legal_name, platform_name, group_npi, tax_id, domain, main_phone, main_email)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'MD Behavioral Health',
    'MD Behavioral Health, LLC',
    'Altrixs',
    '1457893210',
    '82-1234567',
    'mdbehavioralhealth.com',
    '(301) 555-0100',
    'info@mdbehavioralhealth.com'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO practice_locations (id, practice_id, slug, name, address_line1, city, state, zip_code, location_npi, is_flagship, active)
VALUES 
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'bowie', 'Bowie Flagship', '14300 Gallant Fox Ln', 'Bowie', 'MD', '20715', '1457893211', TRUE, TRUE),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'ss', 'Silver Spring', '8401 Colesville Rd', 'Silver Spring', 'MD', '20910', '1457893212', FALSE, TRUE),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'balt', 'Baltimore', '201 E Pratt St', 'Baltimore', 'MD', '21202', '1457893213', FALSE, TRUE),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'lex', 'Lexington Park', '21770 FDR Blvd', 'Lexington Park', 'MD', '20653', '1457893214', FALSE, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 1.2 Clients / Patients (Schema upgrade columns for existing Client table if using Prisma Client table)
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "legalFirstName" VARCHAR(100);
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "middleInitial" VARCHAR(1);
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "legalLastName" VARCHAR(100);
ALTER TABLE IF EXISTS "Client" ADD COLUMN IF NOT EXISTS "rcopiaPatientId" VARCHAR(100);

-- Also create standalone `clients` table if raw SQL architecture is queried directly
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_chart_id VARCHAR(50) UNIQUE NOT NULL,
    legal_first_name VARCHAR(100) NOT NULL,
    middle_initial VARCHAR(1),
    legal_last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender CHAR(1) NOT NULL CHECK (gender IN ('M', 'F', 'U')),
    ssn_last4 VARCHAR(4),
    phone VARCHAR(20),
    mobile_phone VARCHAR(20),
    email VARCHAR(255),
    address_line1 VARCHAR(255) NOT NULL DEFAULT 'UNKNOWN',
    city VARCHAR(100) NOT NULL DEFAULT 'Bowie',
    state VARCHAR(2) NOT NULL DEFAULT 'MD',
    zip_code VARCHAR(10) NOT NULL,
    medicaid_id VARCHAR(50),
    primary_payer_id VARCHAR(100),
    primary_payer_name VARCHAR(255),
    primary_member_id VARCHAR(100),
    rcopia_patient_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 Client Internal Office Notes (Operational / Non-Clinical)
CREATE TABLE IF NOT EXISTS client_office_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('Scheduling', 'Billing', 'Contact Preference', 'Transportation', 'General')),
    note_text TEXT NOT NULL,
    author_name VARCHAR(100) NOT NULL,
    author_role VARCHAR(50) NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_office_notes_client ON client_office_notes(client_id, is_pinned);

-- 1.4 Client Medication Reconciliation (DrFirst Med-History Ready)
CREATE TABLE IF NOT EXISTS client_medications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(100) NOT NULL,
    external_med_id VARCHAR(100),
    rcopia_med_id VARCHAR(100),
    drug_name VARCHAR(255) NOT NULL,
    brand_name VARCHAR(255),
    generic_name VARCHAR(255),
    ndc_code VARCHAR(50),
    rxnorm_id VARCHAR(50),
    dosage_text TEXT NOT NULL,
    action VARCHAR(50),
    dose VARCHAR(50),
    dose_unit VARCHAR(50),
    route VARCHAR(50),
    frequency VARCHAR(100),
    quantity VARCHAR(50),
    refills VARCHAR(20),
    as_needed BOOLEAN DEFAULT FALSE,
    prn_reason VARCHAR(255),
    schedule VARCHAR(20) DEFAULT 'nonscheduled',
    source VARCHAR(50) NOT NULL CHECK (source IN ('rcopia', 'outside_provider', 'self_report', 'prescribed', 'otc')),
    status VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active', 'discontinued', 'pending')),
    start_date DATE,
    stop_date DATE,
    stop_reason TEXT,
    prescriber_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_medications_client ON client_medications(client_id, status);

-- 1.5 Claims & Billing Engine
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_number VARCHAR(50) UNIQUE NOT NULL,
    client_id VARCHAR(100),
    date_of_service DATE NOT NULL,
    payer_name VARCHAR(255) NOT NULL,
    payer_id VARCHAR(50) NOT NULL,
    rendering_provider_name VARCHAR(255) NOT NULL,
    rendering_provider_npi VARCHAR(10) NOT NULL,
    billing_provider_name VARCHAR(255) NOT NULL,
    billing_provider_npi VARCHAR(10) NOT NULL,
    billing_provider_tin VARCHAR(20) NOT NULL,
    prior_auth_number VARCHAR(100),
    place_of_service_code VARCHAR(2) NOT NULL DEFAULT '11',
    diagnoses TEXT[] NOT NULL,
    total_charge NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    claim_status VARCHAR(50) DEFAULT 'ready' CHECK (claim_status IN ('draft', 'ready', 'scrubbed', 'submitted', 'paid', 'denied', 'appeal_in_progress')),
    scrubber_findings JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claim_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID REFERENCES claims(id) ON DELETE CASCADE,
    cpt_code VARCHAR(10) NOT NULL,
    modifiers VARCHAR(10)[],
    units INT NOT NULL DEFAULT 1,
    charge_per_unit NUMERIC(10, 2) NOT NULL,
    total_line_charge NUMERIC(10, 2) NOT NULL,
    diagnosis_pointers INT[] NOT NULL DEFAULT '{1}',
    service_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.6 Waystar 837P Batches & 835 Remittances
CREATE TABLE IF NOT EXISTS waystar_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_control_number VARCHAR(50) UNIQUE NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    claim_count INT NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL,
    x12_content TEXT,
    transfer_status VARCHAR(50) DEFAULT 'staged' CHECK (transfer_status IN ('staged', 'transferred', 'acknowledged_999', 'rejected_277ca', 'failed')),
    aws_transfer_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waystar_batches_ctrl ON waystar_batches(batch_control_number);

CREATE TABLE IF NOT EXISTS payment_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number VARCHAR(50) UNIQUE NOT NULL,
    payer_source VARCHAR(255) NOT NULL,
    reference_number VARCHAR(100) NOT NULL,
    payment_date DATE NOT NULL,
    total_check_amount NUMERIC(12, 2) NOT NULL,
    allocated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft', 'balanced', 'posted')),
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_batch_id UUID REFERENCES payment_batches(id) ON DELETE CASCADE,
    claim_id VARCHAR(100),
    client_id VARCHAR(100),
    date_of_service DATE NOT NULL,
    amount_paid NUMERIC(10, 2) NOT NULL,
    contractual_adjustment NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.7 Client Statements & Payment Plans
CREATE TABLE IF NOT EXISTS statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_number VARCHAR(50) UNIQUE NOT NULL,
    client_id VARCHAR(100),
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    total_charges NUMERIC(10, 2) NOT NULL,
    insurance_paid NUMERIC(10, 2) NOT NULL,
    client_balance NUMERIC(10, 2) NOT NULL,
    sent_via VARCHAR(20) CHECK (sent_via IN ('email', 'sms', 'mail')),
    sent_at TIMESTAMPTZ,
    status VARCHAR(30) DEFAULT 'ready' CHECK (status IN ('ready', 'sent', 'paid', 'payment_plan')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id VARCHAR(100),
    client_id VARCHAR(100) NOT NULL,
    total_balance NUMERIC(10, 2) NOT NULL,
    duration_months INT NOT NULL CHECK (duration_months IN (2, 3, 4, 6)),
    monthly_installment NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_plans_client ON payment_plans(client_id);

-- 1.8 AutoPay & Card Tokenization
CREATE TABLE IF NOT EXISTS client_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(100) NOT NULL,
    gateway_customer_id VARCHAR(255) NOT NULL,
    gateway_payment_method_id VARCHAR(255) NOT NULL,
    card_brand VARCHAR(50) NOT NULL,
    card_last4 VARCHAR(4) NOT NULL,
    expiry_month INT NOT NULL,
    expiry_year INT NOT NULL,
    is_default BOOLEAN DEFAULT TRUE,
    autopay_enabled BOOLEAN DEFAULT FALSE,
    charge_timing VARCHAR(20) DEFAULT 'immediate' CHECK (charge_timing IN ('immediate', '24h', '48h')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.9 Psychiatric Rehabilitation Program (PRP - COMAR 10.63)
CREATE TABLE IF NOT EXISTS prp_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(100) NOT NULL,
    stage VARCHAR(30) NOT NULL DEFAULT 'referral' CHECK (stage IN ('referral', 'enrolled', 'assessed', 'irp')),
    referral_data JSONB DEFAULT '{}'::jsonb,
    enrollment_data JSONB DEFAULT '{}'::jsonb,
    assessment_data JSONB DEFAULT '{}'::jsonb,
    irp_data JSONB DEFAULT '{}'::jsonb,
    qualifying_icd10 VARCHAR(20),
    recommended_domains TEXT[],
    medical_necessity_strength VARCHAR(20) CHECK (medical_necessity_strength IN ('weak', 'moderate', 'strong')),
    prescriber_npi VARCHAR(10),
    prescriber_signature VARCHAR(255),
    irp_effective_date DATE,
    irp_review_due_date DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prp_workflows_client ON prp_workflows(client_id, stage);

-- 1.10 Smart Document Intake (AWS Textract & Bedrock)
CREATE TABLE IF NOT EXISTS document_intakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(20) NOT NULL CHECK (source IN ('Fax', 'Upload', 'Scan', 'Email')),
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('Insurance Card', 'Lab Report', 'Referral', 'Court Order', 'Prior Auth Letter', 'Unclassified')),
    confidence_score NUMERIC(5, 4) NOT NULL,
    suggested_client_id VARCHAR(100),
    suggested_filing_path VARCHAR(255) NOT NULL,
    s3_raw_key VARCHAR(500) NOT NULL,
    extracted_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(30) DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'filed', 'rejected')),
    filed_by_user_id VARCHAR(100),
    filed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_intakes_status ON document_intakes(status);

-- 1.11 Voicemail AI & Triage
CREATE TABLE IF NOT EXISTS voicemails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_name VARCHAR(100),
    caller_phone VARCHAR(20) NOT NULL,
    duration_seconds INT NOT NULL,
    audio_s3_key VARCHAR(500) NOT NULL,
    transcript TEXT NOT NULL,
    intent VARCHAR(30) NOT NULL CHECK (intent IN ('crisis', 'reschedule', 'refill', 'billing', 'general')),
    confidence NUMERIC(5, 4) NOT NULL,
    route_to VARCHAR(100) NOT NULL,
    is_routed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voicemails_intent ON voicemails(intent, is_routed);
