-- ============================================================================
-- MIGRATION: 20261023_sud_radar_auto_measures.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: prescriber feedback (staging): clients on the SUD Referral Radar should get the
--   substance-use measures (AUDIT, CAGE-AID, NIDA-Modified ASSIST, BAM). Clinicians assign them
--   from the radar; this leadership setting (Practice settings > Clinical policy, default OFF)
--   makes the radar scan assign them automatically. Assignments go on the MBC outcome schedule,
--   are deduplicated (an open measure is never assigned again) and audit-logged.
-- ============================================================================

ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "sudRadarAutoAssignMeasures" BOOLEAN NOT NULL DEFAULT false;
