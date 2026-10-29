-- Owner decision 2026-10-17: every Valant aging balance is DISPLAYED as "Over 120" days (per-org
-- setting, default on). Display only: the stored bucket1..5 values on the Valant snapshots are not touched.
-- The owner also accepted the bucket headings "0–30, 31–60, 61–90, 91–120, Over 120", so they are marked
-- confirmed for every organization whose headings were not already confirmed. Idempotent.

ALTER TABLE "ValantAgingSettings" ADD COLUMN IF NOT EXISTS "displayAllOver120" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "ValantAgingSettings" ("organizationId", "labels", "confirmed", "confirmedAt", "updatedAt", "displayAllOver120")
SELECT o."id", '["0–30","31–60","61–90","91–120","Over 120"]'::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true
FROM "Organization" o
ON CONFLICT ("organizationId") DO UPDATE
  SET "labels" = EXCLUDED."labels", "confirmed" = true, "confirmedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "ValantAgingSettings"."confirmed" = false;
