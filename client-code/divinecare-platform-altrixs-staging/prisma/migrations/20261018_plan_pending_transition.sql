-- ============================================================================
-- MIGRATION: 20261018_plan_pending_transition.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: Go-live transition for the "treatment plan required" rule. Valant exported plans for
--   only a fraction of active clients, so until the transition date (go-live + 30 days by
--   default, Treatment Plans > Therapy workflow rules) a therapy progress note for a client
--   whose care started in Valant can be signed without an active plan. Such a note is stamped
--   "Treatment plan pending (go-live transition)", listed for a plan, and warned on the claim.
-- ADDS:
--   * ProgressNoteWorkflow."planPendingUntil" DATE NULL (null = signed normally)
-- NOT TOUCHED: existing rows stay null. The settings (goLiveDate, transitionUntil) live in the
--   existing ClinicModuleState 'therapy-workflow' JSON; no table change for them.
-- (workflow-store.ts ensureWorkflowTable adds the column too, like the co-sign columns.)
-- ============================================================================

ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "planPendingUntil" DATE;
