/**
 * Social Security Number handling (pure). Review note 4: the practice's packet made SSN required;
 * Altrixs makes it OPTIONAL (minimum necessary; Maryland Medicaid uses the MA number), shows it
 * masked (***-**-1234) everywhere, stores the full number only encrypted (src/lib/security/
 * fieldCrypto.ts) and reveals it only to the roles in SSN_REVEAL_ROLES, with an audit row.
 */
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

export const SSN_OPTIONAL_NOTE = 'Optional. Only needed for some insurance billing; Maryland Medicaid uses your MA number.';

/** Roles that may see the full SSN (billing and administration); everyone else sees the mask. */
export const SSN_REVEAL_ROLES = ['ADMIN', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER', 'BILLING'] as const;
export const canRevealSsn = (role: string | null | undefined) => Boolean(role) && (SSN_REVEAL_ROLES as readonly string[]).includes(normalizeStaffRole(role));

/** Digits only, or null when blank. */
export function normalizeSsn(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length ? d : null;
}

/** SSA rules: 9 digits; area not 000, 666 or 900-999; group not 00; serial not 0000. */
export function ssnError(raw: string | null | undefined): string | null {
  const d = normalizeSsn(raw);
  if (d === null) return null; // optional
  if (!/^\d{9}$/.test(d)) return 'A Social Security Number has 9 digits.';
  const area = d.slice(0, 3);
  if (area === '000' || area === '666' || area[0] === '9') return 'That is not a valid Social Security Number.';
  if (d.slice(3, 5) === '00' || d.slice(5) === '0000') return 'That is not a valid Social Security Number.';
  return null;
}

export function ssnLast4(raw: string | null | undefined): string | null {
  const d = normalizeSsn(raw);
  return d && d.length === 9 ? d.slice(5) : null;
}

/** ***-**-1234, or null when none on file. */
export function maskSsn(last4: string | null | undefined): string | null {
  return last4 && /^\d{4}$/.test(last4) ? `***-**-${last4}` : null;
}

export function formatSsn(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
