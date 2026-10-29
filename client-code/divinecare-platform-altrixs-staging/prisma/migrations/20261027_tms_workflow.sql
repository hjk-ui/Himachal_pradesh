-- ============================================================================
-- MIGRATION: 20261027_tms_workflow.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No payer or clinical rows are written
--         (the owner's payer prescriber rules are seeded by the app per organization, as editable
--         practice settings: src/lib/tms/workflowDb.ts ensureOwnerPayerRules).
-- WHY: the owner's TMS steps (Oct 27 2026): referral -> intake packet -> insurance to billing ->
--      verification / authorization -> evaluation & consent -> scheduled course -> in treatment ->
--      completed / discontinued, with a per-payer rule for who may order / supervise TMS.
-- ADDS:
--   * tms_case_workflows   one row per TMS course: stage + history, owner, referral / packet,
--                          billing verification + authorization, indication + device, evaluation /
--                          screening / consent, prescriber, payer verification, booked series.
--   * tms_payer_rules      per-payer TMS prescriber rule (psychiatrist_only | psychiatrist_or_np |
--                          plan_specific), matched by payer name terms / payer type.
--   * "TmsSession".attendance, "TmsSession"."suicidalIdeation" (session log).
-- NOTE: "TmsSession" is read without `select` (GET /api/tms/sessions, POST create), so those
--       routes fail until this runs (the deploy runs migrations first). "TmsCourse" is unchanged.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tms_case_workflows (
  "courseId"                  TEXT PRIMARY KEY REFERENCES "TmsCourse"("id") ON DELETE CASCADE,
  "organizationId"            TEXT NOT NULL,
  "clientId"                  TEXT NOT NULL,
  "stage"                     TEXT NOT NULL DEFAULT 'referral',
  "stageEnteredAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stageHistory"              JSONB NOT NULL DEFAULT '[]'::JSONB,
  "ownerId"                   TEXT,
  "ownerName"                 TEXT,
  "referralSource"            TEXT,
  "referringProvider"         TEXT,
  "packet"                    JSONB NOT NULL DEFAULT '{}'::JSONB,
  "medMgmtAppointmentId"      TEXT,
  "insuranceSentAt"           TIMESTAMP(3),
  "insuranceSentById"         TEXT,
  "verificationStatus"        TEXT,
  "authStatus"                TEXT,
  "authorizedSessions"        INTEGER,
  "priorAuthId"               TEXT,
  "billingNote"               TEXT,
  "verifiedAt"                TIMESTAMP(3),
  "verifiedById"              TEXT,
  "indication"                TEXT,
  "deviceName"                TEXT,
  "deviceClearedForIndication" BOOLEAN,
  "orderingProviderId"        TEXT,
  "payerVerified"             BOOLEAN,
  "payerVerifyNote"           TEXT,
  "evaluation"                JSONB NOT NULL DEFAULT '{}'::JSONB,
  "scheduledProviderId"       TEXT,
  "scheduledSessions"         INTEGER,
  "seriesIds"                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "measureAssignmentId"       TEXT,
  "updatedById"               TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tms_case_workflows_authorized_chk CHECK ("authorizedSessions" IS NULL OR "authorizedSessions" BETWEEN 1 AND 200),
  CONSTRAINT tms_case_workflows_scheduled_chk CHECK ("scheduledSessions" IS NULL OR "scheduledSessions" BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS "tms_case_workflows_organizationId_stage_idx" ON tms_case_workflows ("organizationId", "stage");
CREATE INDEX IF NOT EXISTS "tms_case_workflows_clientId_idx" ON tms_case_workflows ("clientId");

CREATE TABLE IF NOT EXISTS tms_payer_rules (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "payerKey"       TEXT NOT NULL,
  "payerLabel"     TEXT NOT NULL,
  "matchTerms"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payerTypes"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rule"           TEXT NOT NULL,
  "note"           TEXT,
  "source"         TEXT NOT NULL DEFAULT 'staff',
  "active"         BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tms_payer_rules_rule_chk CHECK ("rule" IN ('psychiatrist_only', 'psychiatrist_or_np', 'plan_specific'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "tms_payer_rules_organizationId_payerKey_key" ON tms_payer_rules ("organizationId", "payerKey");

ALTER TABLE "TmsSession" ADD COLUMN IF NOT EXISTS "attendance" TEXT;
ALTER TABLE "TmsSession" ADD COLUMN IF NOT EXISTS "suicidalIdeation" BOOLEAN;
