-- ============================================================================
-- MIGRATION: 20261015_oct15_rcopia_waystar.sql
-- TARGET: PostgreSQL
-- SCOPE: Oct 15 Commits (5e06088 through 98a1a37)
-- ============================================================================

-- 1.1 Waystar Claims, Batches & Remittances
CREATE TABLE IF NOT EXISTS waystar_claim_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_control_number VARCHAR(50) UNIQUE NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    claim_count INT NOT NULL,
    total_charges NUMERIC(12, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'staged' CHECK (status IN ('staged', 'transferred', 'acknowledged_999', 'rejected_277ca', 'failed', 'demo')),
    transfer_id VARCHAR(100),
    transferred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waystar_inbound_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('835', '999', '277CA', 'unknown')),
    s3_key VARCHAR(500) NOT NULL,
    check_number VARCHAR(100),
    total_paid NUMERIC(12, 2),
    claim_count INT,
    processed BOOLEAN DEFAULT FALSE,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 DrFirst Cursors & Prescriptions
CREATE TABLE IF NOT EXISTS drfirst_sync_cursors (
    command_name VARCHAR(50) PRIMARY KEY,
    last_update_date VARCHAR(50) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rcopia_prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    rcopia_id VARCHAR(100) UNIQUE NOT NULL,
    external_id VARCHAR(100),
    provider_name VARCHAR(255),
    provider_npi VARCHAR(10),
    provider_dea VARCHAR(20),
    supervisor_name VARCHAR(255),
    drug_name VARCHAR(255) NOT NULL,
    schedule VARCHAR(10),
    sig TEXT,
    quantity VARCHAR(50),
    refills VARCHAR(20),
    pharmacy_name VARCHAR(255),
    pharmacy_ncpdp_id VARCHAR(50),
    lifecycle_status VARCHAR(30) NOT NULL CHECK (lifecycle_status IN ('pending', 'needs_review', 'signed', 'completed', 'undeliverable', 'cancelled')),
    created_date TIMESTAMPTZ,
    signed_date TIMESTAMPTZ,
    stop_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 Pharmacy Telemetry & Adherence Tracking
CREATE TABLE IF NOT EXISTS rcopia_rxfill_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    prescription_rcopia_id VARCHAR(100) NOT NULL,
    fill_status VARCHAR(30) NOT NULL CHECK (fill_status IN ('dispensed', 'partially_dispensed', 'not_dispensed', 'transferred')),
    reason_code VARCHAR(50),
    fill_notes TEXT,
    pharmacy_name VARCHAR(255),
    fill_date DATE NOT NULL,
    adherence_flag VARCHAR(20) DEFAULT 'ok' CHECK (adherence_flag IN ('ok', 'warning_outreach_needed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rcopia_rxchange_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    rcopia_id VARCHAR(100) UNIQUE NOT NULL,
    ordered_drug_name VARCHAR(255) NOT NULL,
    requested_drug_name VARCHAR(255) NOT NULL,
    request_type VARCHAR(50) NOT NULL,
    change_reason TEXT NOT NULL,
    prior_auth_number VARCHAR(100),
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rcopia_refill_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    provider_username VARCHAR(100) NOT NULL,
    rcopia_order_number VARCHAR(100) NOT NULL,
    drug_prescribed VARCHAR(255) NOT NULL,
    drug_dispensed VARCHAR(255) NOT NULL,
    pharmacy_name VARCHAR(255),
    action_taken VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 Maryland PDMP Audit Log (Legal Compliance)
CREATE TABLE IF NOT EXISTS maryland_pdmp_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    reviewer_username VARCHAR(100) NOT NULL,
    reviewer_npi VARCHAR(10) NOT NULL,
    location_id VARCHAR(100),
    consultation_timestamp TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) DEFAULT 'reviewed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rcopia_med_rec_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    reviewer_username VARCHAR(100) NOT NULL,
    reviewer_npi VARCHAR(10) NOT NULL,
    attestation_date TIMESTAMPTZ NOT NULL,
    meaningful_use_certified BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lightning fast queries
CREATE INDEX IF NOT EXISTS idx_waystar_batches_status ON waystar_claim_batches(status);
CREATE INDEX IF NOT EXISTS idx_waystar_inbound_type ON waystar_inbound_files(file_type, processed);
CREATE INDEX IF NOT EXISTS idx_rcopia_rx_client ON rcopia_prescriptions(client_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_rcopia_rxfill_client ON rcopia_rxfill_events(client_id, adherence_flag);
CREATE INDEX IF NOT EXISTS idx_rcopia_rxchange_client ON rcopia_rxchange_requests(client_id, status);
CREATE INDEX IF NOT EXISTS idx_rcopia_refill_provider ON rcopia_refill_notifications(provider_username, action_taken);
CREATE INDEX IF NOT EXISTS idx_maryland_pdmp_client ON maryland_pdmp_audits(client_id);
CREATE INDEX IF NOT EXISTS idx_rcopia_med_rec_client ON rcopia_med_rec_attestations(client_id);
