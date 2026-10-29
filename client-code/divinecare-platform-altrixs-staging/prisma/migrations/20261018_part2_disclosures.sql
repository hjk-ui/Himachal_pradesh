-- 42 CFR Part 2 disclosures (accounting of disclosures, 42 CFR 2.13(d) / 2.24). Append-only.
CREATE TABLE IF NOT EXISTS "Part2Disclosure" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "consentFormId" TEXT,
  "consentReference" TEXT,
  "basis" TEXT NOT NULL DEFAULT 'consent',
  "disclosedTo" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "informationDisclosed" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "disclosedAt" TIMESTAMP(3) NOT NULL,
  "disclosedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Part2Disclosure_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Part2Disclosure_organizationId_clientId_disclosedAt_idx"
  ON "Part2Disclosure" ("organizationId", "clientId", "disclosedAt");
CREATE INDEX IF NOT EXISTS "Part2Disclosure_organizationId_disclosedAt_idx"
  ON "Part2Disclosure" ("organizationId", "disclosedAt");

-- Rows can be added, never changed or removed by the application.
CREATE OR REPLACE FUNCTION part2_disclosure_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Part2Disclosure is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS part2_disclosure_no_update_delete ON "Part2Disclosure";
CREATE TRIGGER part2_disclosure_no_update_delete BEFORE UPDATE OR DELETE ON "Part2Disclosure"
  FOR EACH ROW EXECUTE FUNCTION part2_disclosure_append_only();
