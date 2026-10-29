/**
 * CRISP launch DOB guard. CRISP matches the patient on name + DOB, so a launch with a
 * missing or substituted DOB could return another person's records. Never substitute a value.
 */
export const MISSING_DOB_MESSAGE =
  'Date of birth is not recorded for this client. Add it to the chart before querying CRISP.';

/** Returns YYYY-MM-DD when `raw` is a real, past calendar date; otherwise null. */
export function normalizeLaunchDob(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    raw = raw.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt.getTime() > Date.now()) return null;
  return s;
}
