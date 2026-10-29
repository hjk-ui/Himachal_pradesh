-- Staff MFA foundation (Oct 24): TOTP fields on User + trusted devices
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaRecoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaLockedUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "MfaTrustedDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "MfaTrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MfaTrustedDevice_tokenHash_key" ON "MfaTrustedDevice"("tokenHash");
CREATE INDEX IF NOT EXISTS "MfaTrustedDevice_userId_idx" ON "MfaTrustedDevice"("userId");
CREATE INDEX IF NOT EXISTS "MfaTrustedDevice_expiresAt_idx" ON "MfaTrustedDevice"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "MfaTrustedDevice"
    ADD CONSTRAINT "MfaTrustedDevice_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
