-- ============================================================================
-- MIGRATION: 20261020_drfirst_certification.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- SCOPE: DrFirst Rcopia certification (docs/drfirst-certification/README.md)
--   * drfirst_settings      GM4: API version stored in the database (seeded 2.54), editable by ADMIN
--   * drfirst_api_logs      GM6 / GM12 / GM13: every Rcopia call + SSO launch. Payloads are stored only
--                           AES-256-GCM encrypted (no credentials, no SSO MAC), ADMIN-only, 90-day purge
--   * drfirst_poll_state    GM8 / DR2 / NCDM1 poll throttles (5 min update_*, 15 min notification count)
--   * Client.addressStatus  PDUM2: 'homeless' | 'unknown' when there is no street address
-- Apply BEFORE deploying the code that reads these tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "drfirst_settings" (
  "key"           TEXT NOT NULL,
  "value"         TEXT NOT NULL,
  "updated_by_id" TEXT,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "drfirst_settings_pkey" PRIMARY KEY ("key")
);
INSERT INTO "drfirst_settings" ("key", "value") VALUES ('api_version', '2.54') ON CONFLICT ("key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "drfirst_api_logs" (
  "id"                UUID NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind"              TEXT NOT NULL,
  "command"           TEXT NOT NULL,
  "servlet"           TEXT,
  "practice_username" TEXT,
  "rcopia_username"   TEXT,
  "organization_id"   TEXT,
  "actor_user_id"     TEXT,
  "ok"                BOOLEAN NOT NULL,
  "http_status"       INTEGER,
  "status"            TEXT,
  "error_code"        TEXT,
  "error_text"        TEXT,
  "duration_ms"       INTEGER,
  "payload_kind"      TEXT,
  "payload_encrypted" TEXT,
  CONSTRAINT "drfirst_api_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "drfirst_api_logs_created_at_idx" ON "drfirst_api_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "drfirst_api_logs_kind_command_created_at_idx" ON "drfirst_api_logs" ("kind", "command", "created_at");

CREATE TABLE IF NOT EXISTS "drfirst_poll_state" (
  "key"            TEXT NOT NULL,
  "last_called_at" TIMESTAMP(3) NOT NULL,
  "payload"        JSONB,
  CONSTRAINT "drfirst_poll_state_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "addressStatus" TEXT;
