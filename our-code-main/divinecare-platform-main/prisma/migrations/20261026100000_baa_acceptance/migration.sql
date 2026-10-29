-- BAA clickwrap acceptances (append-only)
CREATE TABLE IF NOT EXISTS "BaaAcceptance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "textSha256" TEXT NOT NULL,
  "signerName" TEXT NOT NULL,
  "signerTitle" TEXT NOT NULL,
  "signerEmail" TEXT NOT NULL,
  "acceptedById" TEXT,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "via" TEXT NOT NULL DEFAULT 'registration',
  "ip" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "BaaAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BaaAcceptance_organizationId_acceptedAt_idx" ON "BaaAcceptance"("organizationId", "acceptedAt");
CREATE INDEX IF NOT EXISTS "BaaAcceptance_organizationId_version_idx" ON "BaaAcceptance"("organizationId", "version");

DO $$ BEGIN
  ALTER TABLE "BaaAcceptance" ADD CONSTRAINT "BaaAcceptance_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
