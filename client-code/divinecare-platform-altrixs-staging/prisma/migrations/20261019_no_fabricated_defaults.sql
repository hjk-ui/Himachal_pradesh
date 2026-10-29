-- ============================================================================
-- MIGRATION: 20261019_no_fabricated_defaults.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No data is written.
-- SCOPE:
--   * "MandatoryReportRecord"."documentedInChart": drop the assumed TRUE default and
--     allow NULL (= not recorded). Existing rows keep their stored value.
-- ============================================================================

ALTER TABLE "MandatoryReportRecord" ALTER COLUMN "documentedInChart" DROP DEFAULT;
ALTER TABLE "MandatoryReportRecord" ALTER COLUMN "documentedInChart" DROP NOT NULL;
