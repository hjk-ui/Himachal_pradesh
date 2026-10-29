-- ============================================================================
-- MIGRATION: 20261026_integration_call_log.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Admin > Integrations > Logs (/dashboard/admin/integrations/logs). One append-only table of
--   integration calls / jobs (DrFirst, Waystar, Availity, SMS, email, Stripe, Homebase, Bedrock,
--   Textract, Transcribe, Chime, HealthLake, cron). METADATA ONLY: operation, outcome, HTTP /
--   vendor status, sanitized error, timing, correlation id, actor, patient id, and a reference to
--   the integration's own record. No request / response bodies: DrFirst bodies stay encrypted in
--   drfirst_api_logs (90 days) and are reached through source_table / source_id.
-- RETENTION: rows older than 1 year are deleted by scripts/integration-logs-purge.ts (not a cron
--   yet); DrFirst payloads keep their 90-day purge.
-- BACKFILL: existing drfirst_api_logs rows and finished waystar_retrieval_runs, once each
--   (NOT EXISTS on source_table / source_id).
-- Run BEFORE deploying the matching code (the code writes this table; writes fail softly if not).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "integration_call_logs" (
  "id"              UUID NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at"      TIMESTAMPTZ(6) NOT NULL,
  "finished_at"     TIMESTAMPTZ(6) NOT NULL,
  "organization_id" TEXT,
  "integration"     VARCHAR(32) NOT NULL,
  "operation"       VARCHAR(80) NOT NULL,
  "direction"       VARCHAR(16) NOT NULL,
  "status"          VARCHAR(16) NOT NULL,
  "http_status"     INTEGER,
  "vendor_status"   VARCHAR(80),
  "error_code"      VARCHAR(80),
  "error_message"   TEXT,
  "duration_ms"     INTEGER,
  "correlation_id"  VARCHAR(120),
  "actor_user_id"   TEXT,
  "client_id"       TEXT,
  "source_table"    VARCHAR(64),
  "source_id"       VARCHAR(120),
  "metadata"        JSONB,
  CONSTRAINT "integration_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "integration_call_logs_created_at_idx" ON "integration_call_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "integration_call_logs_integration_created_at_idx" ON "integration_call_logs" ("integration", "created_at");
CREATE INDEX IF NOT EXISTS "integration_call_logs_organization_id_created_at_idx" ON "integration_call_logs" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "integration_call_logs_status_created_at_idx" ON "integration_call_logs" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "integration_call_logs_client_id_idx" ON "integration_call_logs" ("client_id");
CREATE INDEX IF NOT EXISTS "integration_call_logs_source_table_source_id_idx" ON "integration_call_logs" ("source_table", "source_id");

-- Backfill: DrFirst call / SSO log (metadata only; the encrypted payload stays where it is)
INSERT INTO "integration_call_logs" (
  "id", "created_at", "started_at", "finished_at", "organization_id", "integration", "operation", "direction",
  "status", "http_status", "vendor_status", "error_code", "error_message", "duration_ms", "actor_user_id",
  "source_table", "source_id", "metadata"
)
SELECT
  md5('drfirst_api_logs:' || d."id"::text)::uuid,
  d."created_at",
  d."created_at" - make_interval(secs => COALESCE(d."duration_ms", 0) / 1000.0),
  d."created_at",
  d."organization_id",
  'drfirst',
  LEFT(LOWER(REGEXP_REPLACE(CASE WHEN d."kind" = 'sso' AND d."command" NOT LIKE 'sso%' THEN 'sso_' || d."command" ELSE d."command" END, '[^A-Za-z0-9:/._-]+', '_', 'g')), 80),
  'outbound',
  CASE WHEN d."ok" THEN 'success' ELSE 'error' END,
  d."http_status",
  LEFT(d."status", 80),
  LEFT(d."error_code", 80),
  LEFT(d."error_text", 500),
  d."duration_ms",
  d."actor_user_id",
  'drfirst_api_logs',
  d."id"::text,
  jsonb_strip_nulls(jsonb_build_object('kind', d."kind", 'servlet', d."servlet", 'rcopiaUsername', d."rcopia_username", 'payloadKind', d."payload_kind"))
FROM "drfirst_api_logs" d
WHERE NOT EXISTS (
  SELECT 1 FROM "integration_call_logs" l WHERE l."source_table" = 'drfirst_api_logs' AND l."source_id" = d."id"::text
)
ON CONFLICT ("id") DO NOTHING;

-- Backfill: Waystar response retrieval runs (deployment-wide, counts only)
INSERT INTO "integration_call_logs" (
  "id", "created_at", "started_at", "finished_at", "organization_id", "integration", "operation", "direction",
  "status", "vendor_status", "error_message", "duration_ms", "actor_user_id", "source_table", "source_id", "metadata"
)
SELECT
  md5('waystar_retrieval_runs:' || r."id"::text)::uuid,
  r."finished_at",
  r."started_at",
  r."finished_at",
  NULL,
  'waystar',
  'sftp_retrieve',
  CASE WHEN r."trigger" = 'cron' THEN 'job' ELSE 'inbound' END,
  CASE WHEN r."status" = 'ok' THEN 'success' ELSE 'error' END,
  LEFT(r."status", 80),
  LEFT(r."error", 500),
  GREATEST(0, (EXTRACT(EPOCH FROM (r."finished_at" - r."started_at")) * 1000)::int),
  r."actor_user_id",
  'waystar_retrieval_runs',
  r."id"::text,
  jsonb_build_object('trigger', r."trigger", 'listed', r."listed", 'requested', r."requested", 'applied', r."applied",
    'claimUpdates', r."claim_updates", 'eraPosted', r."era_posted", 'eraReview', r."era_review",
    'eligibilityUpdated', r."eligibility_updated")
FROM "waystar_retrieval_runs" r
WHERE r."finished_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "integration_call_logs" l WHERE l."source_table" = 'waystar_retrieval_runs' AND l."source_id" = r."id"::text
  )
ON CONFLICT ("id") DO NOTHING;
