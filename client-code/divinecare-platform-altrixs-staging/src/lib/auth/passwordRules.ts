/**
 * Staff password rule constants (client-safe: no common-password list here). The full check,
 * including the bundled common-password list, is checkStaffPassword in ./passwordPolicy (server).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters`;
export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
export const PASSWORD_TOO_LONG = `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;

/** Length-only check for forms (the server also rejects common passwords and your name / email). */
export function passwordLengthError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_TOO_SHORT;
  if (password.length > PASSWORD_MAX_LENGTH) return PASSWORD_TOO_LONG;
  return null;
}
