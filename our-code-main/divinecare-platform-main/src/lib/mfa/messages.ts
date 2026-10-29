/** Exact MFA copy — API errors and UI strings (Oct 24). Import from here only. */

export const MFA_COPY = {
  title: 'Two-factor sign-in',
  prompt: 'Enter the 6-digit code from your authenticator app.',
  useRecovery: 'Use a recovery code',
  useAuthenticator: 'Use authenticator code',
  recoveryPrompt: 'Enter one of your recovery codes.',
  remember: 'Remember this device for 30 days',
  verify: 'Verify',
  enabled: '2FA on',
  notSetUp: '2FA not set up',
  reset: 'Reset 2FA',
} as const;

export const MFA_ERRORS = {
  unauthorized: 'Unauthorized',
  invalidCode: 'That code is not valid. Try again.',
  invalidRecovery: 'That recovery code is not valid.',
  locked: 'Too many attempts. Try again in 15 minutes.',
  notEnrolled: 'Two-factor sign-in is not set up for this account.',
  alreadyEnrolled: 'Two-factor sign-in is already on for this account.',
  notConfigured:
    'Two-factor sign-in is not available yet. Ask an administrator to finish setup.',
  verifyFirst: 'Verify your sign-in code first.',
  forbidden: 'Only an administrator can reset two-factor sign-in.',
  userNotFound: 'Staff member not found.',
} as const;

export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCK_MS = 15 * 60 * 1000;
export const MFA_TRUSTED_DEVICE_DAYS = 30;
export const MFA_RECOVERY_CODE_COUNT = 8;
