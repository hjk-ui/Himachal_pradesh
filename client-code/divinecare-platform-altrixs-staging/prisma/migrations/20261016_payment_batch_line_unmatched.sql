-- PaymentBatchLine.clientId held a patient name when a remittance line had no client id.
-- clientId is now id-only and nullable; the payer's patient label for an unmatched line
-- goes in "unmatchedLabel".
ALTER TABLE "PaymentBatchLine" ADD COLUMN IF NOT EXISTS "unmatchedLabel" TEXT;
ALTER TABLE "PaymentBatchLine" ALTER COLUMN "clientId" DROP NOT NULL;

-- Move existing non-id values (names, 'Unspecified') out of the id column.
UPDATE "PaymentBatchLine" l
SET "unmatchedLabel" = CASE WHEN l."clientId" = 'Unspecified' THEN NULL ELSE l."clientId" END,
    "clientId" = NULL
WHERE l."clientId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Client" c WHERE c.id = l."clientId");
