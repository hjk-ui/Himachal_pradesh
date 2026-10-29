/**
 * Server-side ICD-10-CM validation against the current (FY2027) code set. Used on save by the
 * problem list, lab orders, claims and treatment plans — only on codes being written, so stored
 * (e.g. Valant-imported) codes are never re-judged on read.
 *
 *   ok           — in the code set (and billable when required)
 *   not_billable — a category/header code; HIPAA transactions need a more specific (leaf) code
 *   deleted      — removed from ICD-10-CM this fiscal year
 *   unknown      — not in the FY2027 code set
 *   malformed    — not shaped like an ICD-10-CM code
 */
import { ICD10_FY_LABEL, NON_BILLABLE_MESSAGE, formatIcd10, icd10Key, looksLikeIcd10 } from './normalize';
import { loadIcd10CodeSet, type Icd10CodeSet } from './codeSet';

export type Icd10Status = 'ok' | 'not_billable' | 'deleted' | 'unknown' | 'malformed';
export type Icd10Check = {
  input: string;
  /** Display form ("F33.1") */
  code: string;
  status: Icd10Status;
  description: string | null;
  billable: boolean;
  message: string | null;
};

let warnedUnavailable = false;
function codeSetOrNull(set?: Icd10CodeSet | null): Icd10CodeSet | null {
  if (set) return set;
  try {
    return loadIcd10CodeSet();
  } catch (e) {
    // Never block clinical saves because the data file is missing on a server: shape check only.
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.error('[icd10] code set unavailable; falling back to format checks only:', e instanceof Error ? e.message : e);
    }
    return null;
  }
}

export function checkIcd10Code(
  raw: string,
  opts: { requireBillable?: boolean; codeSet?: Icd10CodeSet | null } = {}
): Icd10Check {
  const input = String(raw ?? '').trim();
  const code = formatIcd10(input);
  if (!looksLikeIcd10(input)) {
    return { input, code, status: 'malformed', description: null, billable: false, message: `"${input}" is not an ICD-10-CM code` };
  }
  const set = codeSetOrNull(opts.codeSet);
  if (!set) return { input, code, status: 'ok', description: null, billable: true, message: null };
  const key = icd10Key(input);
  const row = set.index.byKey.get(key);
  if (row === undefined) {
    const deleted = set.deleted.get(key);
    return deleted !== undefined
      ? { input, code, status: 'deleted', description: deleted, billable: false, message: `${code} was deleted from ICD-10-CM — not in ${ICD10_FY_LABEL} code set` }
      : { input, code, status: 'unknown', description: null, billable: false, message: `${code} is not in ${ICD10_FY_LABEL} code set` };
  }
  const billable = set.index.billable[row] === 1;
  const description = set.index.longs[row];
  if (opts.requireBillable && !billable) {
    return { input, code, status: 'not_billable', description, billable, message: `${code} (${description}): ${NON_BILLABLE_MESSAGE.toLowerCase()}` };
  }
  return { input, code, status: 'ok', description, billable, message: null };
}

/**
 * Validate a list of codes being saved. `codes` in the result are display-formatted and de-duplicated.
 * `skip` holds codes already stored on the record (unchanged codes are not re-judged).
 */
export function validateIcd10Codes(
  raw: string[],
  opts: { requireBillable?: boolean; skip?: string[]; codeSet?: Icd10CodeSet | null } = {}
): { ok: boolean; codes: string[]; checks: Icd10Check[]; errors: string[] } {
  const skip = new Set((opts.skip ?? []).map(icd10Key));
  const checks: Icd10Check[] = [];
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const key = icd10Key(r);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (skip.has(key)) {
      codes.push(String(r).trim().toUpperCase());
      continue;
    }
    const c = checkIcd10Code(r, opts);
    checks.push(c);
    codes.push(c.code);
  }
  const errors = checks.filter((c) => c.status !== 'ok').map((c) => c.message!);
  return { ok: errors.length === 0, codes, checks, errors };
}

/** One-line error for API responses ("F33 ...; Z99.999 is not in FY2027 code set"). */
export function icd10ErrorText(errors: string[]): string {
  return errors.length === 1 ? errors[0] : `${errors.length} diagnosis codes need attention: ${errors.join('; ')}`;
}
