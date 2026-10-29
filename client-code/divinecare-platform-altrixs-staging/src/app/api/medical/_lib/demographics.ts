/**
 * MedicalPatient.dateOfBirth is NOT NULL, so rows auto-created from a client without a DOB
 * were stamped 1990-01-01, and address / emergency contact / payer got placeholder strings.
 * These helpers keep those placeholders from being shown (or printed on letters) as fact.
 */
const DOB_SENTINEL = '1990-01-01';

/** Placeholder strings older auto-created rows were given; never real data. */
const PLACEHOLDER_STRINGS = new Set(['Maryland, US', 'On file', 'Commercial Payer', 'Commercial']);

/** Value written to the NOT NULL dateOfBirth column when the real DOB is unknown. */
export const UNKNOWN_DOB = new Date(`${DOB_SENTINEL}T00:00:00.000Z`);

/** Documented DOB as YYYY-MM-DD, or '' when only the sentinel is on file. */
export function documentedDob(p: { dateOfBirth: Date | null; dob?: Date | null }): string {
  if (p.dob) return p.dob.toISOString().slice(0, 10);
  if (!p.dateOfBirth) return '';
  const iso = p.dateOfBirth.toISOString().slice(0, 10);
  return iso === DOB_SENTINEL ? '' : iso;
}

/** Whole years from a YYYY-MM-DD DOB; 0 means unknown. */
export function ageFromDob(dob: string): number {
  if (!dob) return 0;
  const birth = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return 0;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

/** Drops placeholder strings so the UI shows the field as missing. */
export function realValue(v: string | null | undefined): string {
  const s = (v || '').trim();
  return PLACEHOLDER_STRINGS.has(s) ? '' : s;
}
