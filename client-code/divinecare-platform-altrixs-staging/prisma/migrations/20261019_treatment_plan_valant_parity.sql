-- ============================================================================
-- MIGRATION: 20261019_treatment_plan_valant_parity.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Treatment plan parity with the practice's Valant "Valant Treatment Plan" template:
--   * the plan document header prints the patient name in Valant's format
--     ("PreferredName [FirstName] M. LastName, Suffix (PatientID)"), which needs a preferred
--     name and a suffix on the client (first / middle initial / last already exist);
--   * the plan document is frozen when the clinician signs (header, Problem > Goal > Objective >
--     Intervention hierarchy) so the portal and the print view show exactly what was signed;
--   * guardian(s), guarantor and other signers sign with their typed name and relationship
--     (portal or in office), each with the Valant attestation text.
-- ADDS:
--   * Client."preferredName" TEXT NULL
--   * Client."nameSuffix"    TEXT NULL
--   * TreatmentPlan."signedDocument"  JSONB NULL (null = plan not signed, or signed before this release)
--   * TreatmentPlan."otherSignatures" JSONB NULL (null = no guardian / guarantor / other signer)
-- NOT TOUCHED: existing rows stay null. The Problem > Goal > Objective > Intervention plan
--   content stays in TreatmentPlan.goals (JSON `template.values.tpProblems`); plans saved
--   before this release (`tpGoals`) are read forward-compatibly (src/lib/ehr/therapy/planHierarchy.ts).
--   Library items and the library / review-reminder settings live in ClinicModuleState JSON
--   ('tp-library:practice', 'tp-library:user:<userId>', 'therapy-workflow'); no table change.
-- RUN BEFORE deploying the code that reads these columns.
-- ============================================================================

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "preferredName" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "nameSuffix" TEXT;

ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "signedDocument" JSONB;
ALTER TABLE "TreatmentPlan" ADD COLUMN IF NOT EXISTS "otherSignatures" JSONB;
