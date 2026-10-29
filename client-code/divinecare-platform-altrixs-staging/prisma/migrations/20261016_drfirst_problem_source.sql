-- DrFirst Rcopia problem download (update_problem): mark problem-list rows that came
-- from DrFirst and keep Rcopia's problem id for upserts. Local rows keep source NULL.
-- MedicalProblem.patientId is already optional, so DrFirst problems for a
-- behavioral-health client without a medical chart are stored by clientId only.
-- Idempotent.
ALTER TABLE "MedicalProblem" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "MedicalProblem" ADD COLUMN IF NOT EXISTS "rcopiaProblemId" TEXT;
CREATE INDEX IF NOT EXISTS "MedicalProblem_clientId_rcopiaProblemId_idx" ON "MedicalProblem" ("clientId", "rcopiaProblemId");
