-- ============================================================================
-- MIGRATION: 20261024_staff_mfa_lockout.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: DrFirst security questionnaire (owner approved): staff sign-in hardening.
--   * Two-factor sign-in (TOTP authenticator app) required for staff accounts. The TOTP secret is
--     stored encrypted (fieldCrypto v1, PHI_FIELD_ENCRYPTION_KEY); recovery codes are salted SHA-256.
--   * "Remember this device for 30 days" (MfaTrustedDevice; revoked by an admin 2FA reset or a
--     password change / reset).
--   * Persistent lockout: 5 wrong passwords -> 15 min (User.failedLoginCount / loginLockedUntil);
--     5 wrong 2FA codes -> 15 min (mfaFailedCount / mfaLockedUntil).
--   * Email one-time codes: void after 5 wrong guesses (EmailOtp.attempts); requests counted per account.
--   * Practice setting "Require two-factor sign-in for staff" (PracticeSettings.mfaRequired, default ON).
-- ============================================================================

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginLockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaPendingSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaLastUsedStep" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaRecoveryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaFailedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaLockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaTicketNonceHash" TEXT;

ALTER TABLE "EmailOtp" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "EmailOtp_email_createdAt_idx" ON "EmailOtp"("email", "createdAt");

ALTER TABLE "PracticeSettings" ADD COLUMN IF NOT EXISTS "mfaRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "MfaTrustedDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "MfaTrustedDevice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MfaTrustedDevice_userId_idx" ON "MfaTrustedDevice"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MfaTrustedDevice_userId_fkey') THEN
    ALTER TABLE "MfaTrustedDevice"
      ADD CONSTRAINT "MfaTrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
