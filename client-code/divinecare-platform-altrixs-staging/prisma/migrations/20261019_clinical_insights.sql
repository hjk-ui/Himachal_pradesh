-- Clinical Insights (/dashboard/ai-insights): nightly / on-demand per-client snapshot and scan runs.
-- One slim row per evaluated client: tier, the rule ids that fired, signals (values + dates) and a
-- compact trend history. No names, no free text: name / MRN / clinician / location are read live
-- from "Client" and each viewer's org / caseload scope and 42 CFR Part 2 lock apply on read.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "clinical_insight_snapshots" (
  "organization_id" TEXT NOT NULL,
  "client_id"       TEXT NOT NULL,
  "run_id"          TEXT,
  "scanned_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- urgent | high | watch | stable
  "tier"            VARCHAR(10) NOT NULL DEFAULT 'stable',
  "rank"            INTEGER NOT NULL DEFAULT 0,
  -- InsightRow minus the live header fields (src/lib/insights/clinical/population.ts)
  "row"             JSONB NOT NULL DEFAULT '{}',
  -- RowHistory: weekly attended / missed counts, monthly seen / measured / trajectory flags
  "history"         JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY ("organization_id", "client_id")
);
CREATE INDEX IF NOT EXISTS "clinical_insight_snapshots_org_tier_idx"
  ON "clinical_insight_snapshots" ("organization_id", "tier");

CREATE TABLE IF NOT EXISTS "clinical_insight_scan_runs" (
  "id"               TEXT PRIMARY KEY,
  "organization_id"  TEXT NOT NULL,
  -- cron | manual | first-visit
  "trigger"          TEXT NOT NULL,
  -- organization | caseload
  "scope"            TEXT NOT NULL,
  "actor_user_id"    TEXT,
  "status"           TEXT NOT NULL DEFAULT 'running',
  "started_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at"      TIMESTAMPTZ(6),
  "clients_scanned"  INTEGER NOT NULL DEFAULT 0,
  "sensitive_hidden" INTEGER NOT NULL DEFAULT 0,
  "truncated"        BOOLEAN NOT NULL DEFAULT false,
  "duration_ms"      INTEGER,
  -- tier counts only
  "counts"           JSONB
);
CREATE INDEX IF NOT EXISTS "clinical_insight_scan_runs_org_started_idx"
  ON "clinical_insight_scan_runs" ("organization_id", "started_at");
