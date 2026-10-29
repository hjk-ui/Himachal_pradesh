-- Service Eligibility Scanner: nightly / on-demand snapshot, scan runs, suggestion workflow
-- (accept / dismiss / snooze / outcome) and per-program leads. Idempotent.

CREATE TABLE IF NOT EXISTS "service_eligibility_snapshots" (
  "organization_id" TEXT NOT NULL,
  "client_id"       TEXT NOT NULL,
  "scanned_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "run_id"          TEXT,
  -- {"prp":"candidate","tms":"not_indicated",...}
  "statuses"        JSONB NOT NULL DEFAULT '{}',
  "any_indicated"   BOOLEAN NOT NULL DEFAULT false,
  "priority_score"  INTEGER NOT NULL DEFAULT 0,
  -- ScannedClient minus live header fields (name / MRN / clinician / location are read live)
  "summary"         JSONB NOT NULL DEFAULT '{}',
  "results"         JSONB,
  PRIMARY KEY ("organization_id", "client_id")
);
CREATE INDEX IF NOT EXISTS "service_eligibility_snapshots_org_indicated_idx"
  ON "service_eligibility_snapshots" ("organization_id", "any_indicated");

CREATE TABLE IF NOT EXISTS "service_eligibility_scan_runs" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL,
  "trigger"          TEXT NOT NULL,
  "scope"            TEXT NOT NULL,
  "actor_user_id"    TEXT,
  "status"           TEXT NOT NULL DEFAULT 'running',
  "started_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at"      TIMESTAMPTZ(6),
  "clients_scanned"  INTEGER NOT NULL DEFAULT 0,
  "sensitive_hidden" INTEGER NOT NULL DEFAULT 0,
  "truncated"        BOOLEAN NOT NULL DEFAULT false,
  "duration_ms"      INTEGER,
  "counts"           JSONB
);
CREATE INDEX IF NOT EXISTS "service_eligibility_scan_runs_org_started_idx"
  ON "service_eligibility_scan_runs" ("organization_id", "started_at");

CREATE TABLE IF NOT EXISTS "service_eligibility_decisions" (
  "id"                TEXT PRIMARY KEY,
  "organization_id"   TEXT NOT NULL,
  "client_id"         TEXT NOT NULL,
  "program"           TEXT NOT NULL,
  -- accepted | dismissed | snoozed
  "action"            TEXT NOT NULL,
  -- not_appropriate | client_declined | referred_elsewhere | other (dismiss only)
  "reason"            TEXT,
  "reason_note"       TEXT,
  "snooze_until"      TIMESTAMPTZ(6),
  "referral_alert_id" TEXT,
  "recipient_user_id" TEXT,
  -- referred | enrolled | declined | not_enrolled (accepted only)
  "outcome"           TEXT,
  "outcome_at"        TIMESTAMPTZ(6),
  -- status the scanner showed when the decision was made
  "status_at_decision" TEXT,
  "decided_by_id"     TEXT NOT NULL,
  "decided_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_eligibility_decisions_org_client_program_key"
  ON "service_eligibility_decisions" ("organization_id", "client_id", "program");
CREATE INDEX IF NOT EXISTS "service_eligibility_decisions_org_program_action_idx"
  ON "service_eligibility_decisions" ("organization_id", "program", "action");

CREATE TABLE IF NOT EXISTS "service_eligibility_program_leads" (
  "organization_id" TEXT NOT NULL,
  "program"         TEXT NOT NULL,
  "lead_user_id"    TEXT NOT NULL,
  "updated_by_id"   TEXT,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "program")
);
