-- ============================================================================
-- MIGRATION: 20261017_waystar_inbound_era_eligibility.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- SCOPE: Waystar inbound (src/lib/billing/waystarInbound)
--   * waystar_inbound_files: per-file processing lock, summary, unique file name,
--     file types 271 / 277 / TA1
--   * waystar_retrieval_runs: one row per scheduled / manual /Download pull
--   * waystar_outbound_files: 270 eligibility and 276 claim status batches
--   * era_remittances / era_claim_payments / era_adjustments: parsed 835s,
--     posting state, ERA review queue, CAS detail for secondary (COB) claims
-- Run after 20261015_oct15_rcopia_waystar.sql and 20261016_waystar_outbound_complete.sql.
-- ============================================================================

-- 1. waystar_inbound_files ---------------------------------------------------
ALTER TABLE waystar_inbound_files DROP CONSTRAINT IF EXISTS waystar_inbound_files_file_type_check;
DO $$ BEGIN
  ALTER TABLE waystar_inbound_files ADD CONSTRAINT waystar_inbound_files_file_type_check
    CHECK (file_type IN ('835', '999', '277CA', '277', '271', 'TA1', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE waystar_inbound_files ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ(6);
ALTER TABLE waystar_inbound_files ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ(6);
ALTER TABLE waystar_inbound_files ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE waystar_inbound_files ADD COLUMN IF NOT EXISTS summary JSONB;
ALTER TABLE waystar_inbound_files ADD COLUMN IF NOT EXISTS error TEXT;

-- The old retrieve route could insert the same file twice. Keep one row per file name
-- (a processed row first, else the earliest) before adding the unique index.
DELETE FROM waystar_inbound_files f
 USING waystar_inbound_files keep
 WHERE f.file_name = keep.file_name
   AND f.id <> keep.id
   AND (COALESCE(keep.processed, false)::int, -extract(epoch FROM COALESCE(keep.received_at, NOW())), keep.id::text)
     > (COALESCE(f.processed, false)::int, -extract(epoch FROM COALESCE(f.received_at, NOW())), f.id::text);
CREATE UNIQUE INDEX IF NOT EXISTS waystar_inbound_files_file_name_key ON waystar_inbound_files(file_name);
CREATE INDEX IF NOT EXISTS waystar_inbound_files_file_type_processed_idx ON waystar_inbound_files(file_type, processed);

-- 2. Retrieval runs ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS waystar_retrieval_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger VARCHAR(20) NOT NULL,
    actor_user_id TEXT,
    started_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ(6),
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    listed INT NOT NULL DEFAULT 0,
    requested INT NOT NULL DEFAULT 0,
    applied INT NOT NULL DEFAULT 0,
    claim_updates INT NOT NULL DEFAULT 0,
    era_posted INT NOT NULL DEFAULT 0,
    era_review INT NOT NULL DEFAULT 0,
    eligibility_updated INT NOT NULL DEFAULT 0,
    error TEXT,
    summary JSONB
);
CREATE INDEX IF NOT EXISTS waystar_retrieval_runs_started_at_idx ON waystar_retrieval_runs(started_at);

-- 3. 270 / 276 outbound files ------------------------------------------------
CREATE TABLE IF NOT EXISTS waystar_outbound_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(4) NOT NULL CHECK (kind IN ('270', '276')),
    organization_id TEXT NOT NULL,
    batch_id VARCHAR(60) NOT NULL,
    control_number VARCHAR(20) NOT NULL,
    file_name TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    transfer_id TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'staged',
    usage_indicator VARCHAR(1) NOT NULL DEFAULT 'T',
    item_count INT NOT NULL,
    item_ids TEXT[] NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    ack_at TIMESTAMPTZ(6),
    ack_detail TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS waystar_outbound_files_batch_id_key ON waystar_outbound_files(batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS waystar_outbound_files_control_number_key ON waystar_outbound_files(control_number);
CREATE INDEX IF NOT EXISTS waystar_outbound_files_organization_id_kind_created_at_idx ON waystar_outbound_files(organization_id, kind, created_at);

-- 4. 835 ERA -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS era_remittances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inbound_file_id UUID,
    file_name TEXT NOT NULL,
    organization_id TEXT,
    trace_number VARCHAR(50) NOT NULL,
    payer_trace_id VARCHAR(50) NOT NULL DEFAULT '',
    payer_name TEXT,
    payer_id TEXT,
    payee_npi TEXT,
    payment_method VARCHAR(5),
    credit_debit VARCHAR(1),
    payment_amount NUMERIC(12, 2) NOT NULL,
    payment_date DATE,
    provider_adjustments JSONB,
    plb_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    claim_count INT NOT NULL,
    balanced BOOLEAN NOT NULL DEFAULT TRUE,
    balance_errors TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'review',
    payment_batch_id TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
-- Never post the same payment twice: TRN02 + TRN03 identify one payment
CREATE UNIQUE INDEX IF NOT EXISTS era_remittances_trace_number_payer_trace_id_key ON era_remittances(trace_number, payer_trace_id);
CREATE INDEX IF NOT EXISTS era_remittances_organization_id_created_at_idx ON era_remittances(organization_id, created_at);

CREATE TABLE IF NOT EXISTS era_claim_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remittance_id UUID NOT NULL,
    seq INT NOT NULL,
    organization_id TEXT,
    claim_id TEXT,
    match_kind VARCHAR(20) NOT NULL DEFAULT 'none',
    patient_control_number VARCHAR(50) NOT NULL,
    status_code VARCHAR(4) NOT NULL,
    charge_amount NUMERIC(12, 2) NOT NULL,
    paid_amount NUMERIC(12, 2) NOT NULL,
    patient_responsibility NUMERIC(12, 2) NOT NULL DEFAULT 0,
    filing_indicator VARCHAR(4),
    payer_claim_control_number VARCHAR(50),
    patient_label TEXT,
    member_id TEXT,
    service_date_from DATE,
    service_date_to DATE,
    claim_adjustments JSONB NOT NULL DEFAULT '[]',
    service_lines JSONB NOT NULL DEFAULT '[]',
    remarks TEXT[] NOT NULL DEFAULT '{}',
    outcome VARCHAR(30) NOT NULL,
    posting_status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (posting_status IN ('pending', 'posted', 'review', 'dismissed', 'duplicate')),
    review_reasons TEXT[] NOT NULL DEFAULT '{}',
    suggestions JSONB,
    payment_id TEXT,
    posted_at TIMESTAMPTZ(6),
    posted_by TEXT,
    resolution_note TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE era_claim_payments ADD CONSTRAINT era_claim_payments_remittance_id_fkey
    FOREIGN KEY (remittance_id) REFERENCES era_remittances(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS era_claim_payments_remittance_id_seq_key ON era_claim_payments(remittance_id, seq);
CREATE INDEX IF NOT EXISTS era_claim_payments_claim_id_idx ON era_claim_payments(claim_id);
CREATE INDEX IF NOT EXISTS era_claim_payments_organization_id_posting_status_idx ON era_claim_payments(organization_id, posting_status);
CREATE INDEX IF NOT EXISTS era_claim_payments_patient_control_number_idx ON era_claim_payments(patient_control_number);
-- At most one posted ERA claim payment per (claim, remittance)
CREATE UNIQUE INDEX IF NOT EXISTS era_claim_payments_posted_once ON era_claim_payments(claim_id, remittance_id)
  WHERE posting_status = 'posted';

CREATE TABLE IF NOT EXISTS era_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    era_claim_id UUID NOT NULL,
    organization_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    level VARCHAR(5) NOT NULL CHECK (level IN ('claim', 'line')),
    line_seq INT,
    service_line_id TEXT,
    procedure_code VARCHAR(10),
    group_code VARCHAR(2) NOT NULL,
    carc VARCHAR(5) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    quantity NUMERIC(10, 2),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE era_adjustments ADD CONSTRAINT era_adjustments_era_claim_id_fkey
    FOREIGN KEY (era_claim_id) REFERENCES era_claim_payments(id) ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS era_adjustments_claim_id_idx ON era_adjustments(claim_id);
CREATE INDEX IF NOT EXISTS era_adjustments_era_claim_id_idx ON era_adjustments(era_claim_id);
