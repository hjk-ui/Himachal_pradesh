-- Residential / crisis per-diem charges become organization- and patient-scoped.
ALTER TABLE "SpecializedBillingCharge" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "SpecializedBillingCharge" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "SpecializedBillingCharge" ADD COLUMN IF NOT EXISTS "claimId" TEXT;
CREATE INDEX IF NOT EXISTS "SpecializedBillingCharge_organizationId_category_serviceDate_idx"
  ON "SpecializedBillingCharge" ("organizationId", "category", "serviceDate");
