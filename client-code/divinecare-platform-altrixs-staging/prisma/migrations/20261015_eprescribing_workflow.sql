-- ==============================================================================
-- Migration: E-Prescribing & EPCS Workflow Engine Tables
-- Date: 2026-10-15
-- Tables: practice_pharmacies, ehr_prescriptions, ehr_refill_requests
-- ==============================================================================

-- 1. Practice Pharmacies
CREATE TABLE IF NOT EXISTS practice_pharmacies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ncpdp_id VARCHAR(50) UNIQUE NOT NULL,
    store_name VARCHAR(255) NOT NULL,
    chain_name VARCHAR(100),
    phone VARCHAR(20) NOT NULL,
    fax VARCHAR(20),
    address_line1 VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    zip_code VARCHAR(10) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed top Maryland pharmacies
INSERT INTO practice_pharmacies (ncpdp_id, store_name, chain_name, phone, address_line1, city, state, zip_code)
VALUES 
('NCPDP-210481', 'CVS Pharmacy #1420 - Bowie', 'CVS', '(301) 555-0144', '15500 Annapolis Rd', 'Bowie', 'MD', '20715'),
('NCPDP-210482', 'Walgreens #9812 - Silver Spring', 'Walgreens', '(301) 555-0199', '13870 Georgia Ave', 'Silver Spring', 'MD', '20906'),
('NCPDP-210483', 'Rite Aid #3811 - Baltimore', 'Rite Aid', '(410) 555-0122', '2801 Smith Ave', 'Baltimore', 'MD', '21209'),
('NCPDP-210484', 'Giant Pharmacy #230 - Towson', 'Giant', '(410) 555-0188', '6223 N Charles St', 'Towson', 'MD', '21212')
ON CONFLICT (ncpdp_id) DO NOTHING;

-- 2. EHR Prescriptions
CREATE TABLE IF NOT EXISTS ehr_prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rx_number VARCHAR(50) UNIQUE NOT NULL,
    client_id VARCHAR(255) REFERENCES "Client"(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    prescriber_id VARCHAR(255),
    prescriber_name VARCHAR(255) NOT NULL,
    prescriber_npi VARCHAR(10) NOT NULL,
    prescriber_dea VARCHAR(20),
    medication_name VARCHAR(255) NOT NULL,
    medication_class VARCHAR(100),
    dea_schedule VARCHAR(10) NOT NULL DEFAULT 'None' CHECK (dea_schedule IN ('None', 'II', 'III', 'IV', 'V')),
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    days_supply INT NOT NULL DEFAULT 30,
    refills_allowed INT NOT NULL DEFAULT 0,
    refills_remaining INT NOT NULL DEFAULT 0,
    pharmacy_id UUID REFERENCES practice_pharmacies(id) ON DELETE SET NULL,
    pharmacy_name VARCHAR(255) NOT NULL,
    notes_to_pharmacist TEXT,
    pdmp_checked BOOLEAN DEFAULT FALSE,
    pdmp_checked_at TIMESTAMPTZ,
    epcs_attested BOOLEAN DEFAULT FALSE,
    status VARCHAR(30) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Pending', 'Discontinued', 'Expired')),
    transmission_status VARCHAR(50) DEFAULT 'Sent' CHECK (transmission_status IN ('Pending', 'Sent', 'Failed', 'Delivered')),
    last_filled_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. EHR Refill Requests
CREATE TABLE IF NOT EXISTS ehr_refill_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID REFERENCES ehr_prescriptions(id) ON DELETE CASCADE,
    client_id VARCHAR(255) REFERENCES "Client"(id) ON DELETE CASCADE,
    client_name VARCHAR(255) NOT NULL,
    medication_name VARCHAR(255) NOT NULL,
    pharmacy_name VARCHAR(255) NOT NULL,
    requested_refills INT NOT NULL DEFAULT 1,
    request_date TIMESTAMPTZ DEFAULT NOW(),
    last_filled_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Denied')),
    decision_reason TEXT,
    decided_by_name VARCHAR(255),
    decided_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ehr_prescriptions_client ON ehr_prescriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_ehr_prescriptions_status ON ehr_prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_ehr_prescriptions_dea ON ehr_prescriptions(dea_schedule);
CREATE INDEX IF NOT EXISTS idx_ehr_refill_requests_status ON ehr_refill_requests(status);
CREATE INDEX IF NOT EXISTS idx_ehr_refill_requests_client ON ehr_refill_requests(client_id);
