-- Practice fee schedule imported from Valant (Billing -> Fee Schedule). Idempotent.
CREATE TABLE IF NOT EXISTS "FeeScheduleItem" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "code"              TEXT NOT NULL,
  "description"       TEXT NOT NULL,
  "feeCents"          INTEGER NOT NULL,
  "billedCpt"         TEXT,
  "baseCpt"           TEXT,
  "telehealth"        BOOLEAN NOT NULL DEFAULT false,
  "selfPay"           BOOLEAN NOT NULL DEFAULT false,
  "child"             BOOLEAN NOT NULL DEFAULT false,
  "itp"               BOOLEAN NOT NULL DEFAULT false,
  "exactOnly"         BOOLEAN NOT NULL DEFAULT false,
  "variantLabel"      TEXT NOT NULL,
  "insuranceBillable" BOOLEAN NOT NULL DEFAULT false,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "source"            TEXT NOT NULL DEFAULT 'valant',
  "needsReview"       BOOLEAN NOT NULL DEFAULT false,
  "reviewNote"        TEXT,
  "importedAt"        TIMESTAMP(3),
  "editedById"        TEXT,
  "editedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeScheduleItem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FeeScheduleItem" ADD COLUMN IF NOT EXISTS "exactOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FeeScheduleItem" ADD COLUMN IF NOT EXISTS "importedAt" TIMESTAMP(3);
ALTER TABLE "FeeScheduleItem" ADD COLUMN IF NOT EXISTS "editedById" TEXT;
ALTER TABLE "FeeScheduleItem" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "FeeScheduleItem_organizationId_code_key"
  ON "FeeScheduleItem" ("organizationId", "code");
CREATE INDEX IF NOT EXISTS "FeeScheduleItem_organizationId_baseCpt_active_idx"
  ON "FeeScheduleItem" ("organizationId", "baseCpt", "active");
