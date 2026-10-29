-- ============================================================================
-- MIGRATION: 20261022_primary_care_workflow.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: primary care workflow (athenaOne / eCW style): MA rooming, care gaps, referral tracking,
--   the warm handoff to the practice behavioral health team, provider -> MA tasks, closed-loop
--   result notification and primary care practice settings. Rules: src/lib/medical/primaryCareWorkflow.ts
-- CHANGES:
--   * medical_roomings          one per appointment (UNIQUE appointment_id): identity check, chief
--                               complaint, vitals json (with BP recheck), checks json (allergy / med /
--                               pharmacy review, screenings, POC results, patient-reported items),
--                               status draft | ready | in_room, roomed_by / roomed_at / in_room_at.
--   * medical_care_gap_actions  append-only actions per patient + gap (provider: completed | ordered |
--                               done_elsewhere | refused | not_applicable | reopened; MA:
--                               reported_elsewhere | outreach).
--   * medical_referrals         specialist / imaging / internal_bh tracking: sent -> scheduled -> seen
--                               -> report_received (internal_bh: no report; status only).
--   * medical_tasks             provider -> Medical Assistant tasks.
--   * primary_care_settings     results_notify_days (default 7), poc_standing_orders (default EMPTY
--                               '[]'), care_gaps_disabled (default none).
--   * "LabOrder"                patientNotifiedAt / patientNotifiedMethod / patientNotifiedById /
--                               patientNotifiedByName (closed loop: patient told of the result).
-- ============================================================================

-- ─── medical_roomings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_roomings (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"    TEXT NOT NULL,
  "appointment_id"     TEXT NOT NULL,
  "client_id"          TEXT NOT NULL,
  "status"             VARCHAR(20) NOT NULL DEFAULT 'draft',
  "identity_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "identifiers"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "chief_complaint"    TEXT,
  "vitals"             JSONB,
  "checks"             JSONB,
  "vital_ids"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "roomed_by_id"       TEXT,
  "roomed_by_name"     TEXT,
  "roomed_at"          TIMESTAMP(3),
  "in_room_at"         TIMESTAMP(3),
  "in_room_by_id"      TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE medical_roomings ADD CONSTRAINT "medical_roomings_status_check"
    CHECK ("status" IN ('draft', 'ready', 'in_room'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_roomings ADD CONSTRAINT "medical_roomings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_roomings ADD CONSTRAINT "medical_roomings_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_roomings ADD CONSTRAINT "medical_roomings_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "medical_roomings_appointment_id_key" ON medical_roomings ("appointment_id");
CREATE INDEX IF NOT EXISTS "medical_roomings_organization_id_status_idx" ON medical_roomings ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "medical_roomings_client_id_idx" ON medical_roomings ("client_id");

-- ─── medical_care_gap_actions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_care_gap_actions (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"  TEXT NOT NULL,
  "client_id"        TEXT NOT NULL,
  "gap_key"          VARCHAR(40) NOT NULL,
  "action"           VARCHAR(30) NOT NULL,
  "performed_on"     DATE,
  "kind"             VARCHAR(40),
  "source"           TEXT,
  "reason"           TEXT,
  "method"           VARCHAR(20),
  "appointment_id"   TEXT,
  "patient_reported" BOOLEAN NOT NULL DEFAULT false,
  "recorded_by_id"   TEXT NOT NULL,
  "recorded_by_name" TEXT,
  "recorded_by_role" VARCHAR(40),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE medical_care_gap_actions ADD CONSTRAINT "medical_care_gap_actions_action_check"
    CHECK ("action" IN ('completed', 'ordered', 'done_elsewhere', 'refused', 'not_applicable', 'reopened', 'reported_elsewhere', 'outreach'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_care_gap_actions ADD CONSTRAINT "medical_care_gap_actions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_care_gap_actions ADD CONSTRAINT "medical_care_gap_actions_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_care_gap_actions ADD CONSTRAINT "medical_care_gap_actions_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "medical_care_gap_actions_org_client_gap_idx" ON medical_care_gap_actions ("organization_id", "client_id", "gap_key");
CREATE INDEX IF NOT EXISTS "medical_care_gap_actions_appointment_id_idx" ON medical_care_gap_actions ("appointment_id");

-- ─── medical_referrals ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_referrals (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"    TEXT NOT NULL,
  "client_id"          TEXT NOT NULL,
  "kind"               VARCHAR(20) NOT NULL,
  "target"             TEXT NOT NULL,
  "facility"           TEXT,
  "reason"             TEXT NOT NULL,
  "urgency"            VARCHAR(10) NOT NULL DEFAULT 'routine',
  "cpt"                VARCHAR(10),
  "icd10_codes"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"             VARCHAR(20) NOT NULL DEFAULT 'sent',
  "status_note"        TEXT,
  "scheduled_for"      DATE,
  "seen_at"            DATE,
  "report_received_at" TIMESTAMP(3),
  "appointment_id"     TEXT,
  "ordered_by_id"      TEXT NOT NULL,
  "ordered_by_name"    TEXT,
  "updated_by_id"      TEXT,
  "sent_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE medical_referrals ADD CONSTRAINT "medical_referrals_kind_check"
    CHECK ("kind" IN ('specialist', 'imaging', 'internal_bh'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_referrals ADD CONSTRAINT "medical_referrals_status_check"
    CHECK ("status" IN ('sent', 'scheduled', 'seen', 'report_received', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_referrals ADD CONSTRAINT "medical_referrals_urgency_check"
    CHECK ("urgency" IN ('routine', 'urgent', 'stat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_referrals ADD CONSTRAINT "medical_referrals_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_referrals ADD CONSTRAINT "medical_referrals_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_referrals ADD CONSTRAINT "medical_referrals_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "medical_referrals_org_kind_status_idx" ON medical_referrals ("organization_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "medical_referrals_client_id_idx" ON medical_referrals ("client_id");

-- ─── medical_tasks ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medical_tasks (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" TEXT NOT NULL,
  "client_id"       TEXT,
  "title"           TEXT NOT NULL,
  "detail"          TEXT,
  "assigned_to_id"  TEXT,
  "due_on"          DATE,
  "status"          VARCHAR(20) NOT NULL DEFAULT 'open',
  "created_by_id"   TEXT NOT NULL,
  "created_by_name" TEXT,
  "completed_by_id" TEXT,
  "completed_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE medical_tasks ADD CONSTRAINT "medical_tasks_status_check"
    CHECK ("status" IN ('open', 'done', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_tasks ADD CONSTRAINT "medical_tasks_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE medical_tasks ADD CONSTRAINT "medical_tasks_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "medical_tasks_organization_id_status_idx" ON medical_tasks ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "medical_tasks_assigned_to_id_status_idx" ON medical_tasks ("assigned_to_id", "status");
CREATE INDEX IF NOT EXISTS "medical_tasks_client_id_idx" ON medical_tasks ("client_id");

-- ─── primary_care_settings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS primary_care_settings (
  "organization_id"     TEXT PRIMARY KEY,
  "results_notify_days" INTEGER NOT NULL DEFAULT 7,
  "poc_standing_orders" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "care_gaps_disabled"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updated_by_id"       TEXT,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE primary_care_settings ADD CONSTRAINT "primary_care_settings_results_notify_days_check"
    CHECK ("results_notify_days" BETWEEN 1 AND 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE primary_care_settings ADD CONSTRAINT "primary_care_settings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── LabOrder: patient notified of the result ───────────────────────────────
ALTER TABLE "LabOrder" ADD COLUMN IF NOT EXISTS "patientNotifiedAt" TIMESTAMP(3);
ALTER TABLE "LabOrder" ADD COLUMN IF NOT EXISTS "patientNotifiedMethod" TEXT;
ALTER TABLE "LabOrder" ADD COLUMN IF NOT EXISTS "patientNotifiedById" TEXT;
ALTER TABLE "LabOrder" ADD COLUMN IF NOT EXISTS "patientNotifiedByName" TEXT;
