-- ============================================================================
-- MIGRATION: 20261021_visit_checklist.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data rows are written.
-- WHY: the Visit Guide (src/lib/visits/*) shows each visit's protocol steps. Steps the chart
--   cannot prove ('manual' steps, or an 'auto' step the clinician marks not applicable /
--   deferred with a reason) are stored here, one row per appointment + step.
-- CHANGES:
--   * visit_checklist_items  id, organization_id, client_id -> Client, appointment_id -> Appointment
--                            (nullable: visits without an appointment), note_id (nullable),
--                            visit_kind, step_id, status (done | not_applicable | deferred),
--                            reason (required for not_applicable / deferred, enforced by the API),
--                            marked_by_id, marked_at.
--                            UNIQUE (appointment_id, step_id): NULL appointment ids never collide.
-- ============================================================================

CREATE TABLE IF NOT EXISTS visit_checklist_items (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" TEXT NOT NULL,
  "client_id"       TEXT NOT NULL,
  "appointment_id"  TEXT,
  "note_id"         TEXT,
  "visit_kind"      VARCHAR(40) NOT NULL,
  "step_id"         VARCHAR(60) NOT NULL,
  "status"          VARCHAR(20) NOT NULL,
  "reason"          TEXT,
  "marked_by_id"    TEXT NOT NULL,
  "marked_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE visit_checklist_items ADD CONSTRAINT "visit_checklist_items_status_check"
    CHECK ("status" IN ('done', 'not_applicable', 'deferred'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE visit_checklist_items ADD CONSTRAINT "visit_checklist_items_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE visit_checklist_items ADD CONSTRAINT "visit_checklist_items_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE visit_checklist_items ADD CONSTRAINT "visit_checklist_items_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "visit_checklist_items_appointment_id_step_id_key"
  ON visit_checklist_items ("appointment_id", "step_id");
CREATE INDEX IF NOT EXISTS "visit_checklist_items_client_id_idx"
  ON visit_checklist_items ("client_id");
CREATE INDEX IF NOT EXISTS "visit_checklist_items_organization_id_client_id_marked_at_idx"
  ON visit_checklist_items ("organization_id", "client_id", "marked_at");
