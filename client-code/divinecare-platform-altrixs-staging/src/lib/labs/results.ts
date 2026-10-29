/**
 * Result value / reference-range parsing and abnormal-flag computation. Pure (browser + tests).
 * Flags: N normal, H high, L low, HH critical high, LL critical low, A abnormal (qualitative).
 * Critical limits are only what staff enter from the performing lab's report; none are defaulted.
 */

export const LAB_RESULT_FLAGS = ['N', 'H', 'L', 'HH', 'LL', 'A'] as const;
export type LabResultFlag = (typeof LAB_RESULT_FLAGS)[number];

export const FLAG_LABEL: Record<LabResultFlag, string> = {
  N: 'Normal',
  H: 'High',
  L: 'Low',
  HH: 'Critical high',
  LL: 'Critical low',
  A: 'Abnormal',
};

export const isCriticalFlag = (f: string | null | undefined) => f === 'HH' || f === 'LL';
export const isAbnormalFlag = (f: string | null | undefined) => Boolean(f) && f !== 'N';

export type ParsedValue = { num: number; qualifier: '<' | '>' | '<=' | '>=' | null } | null;

/** "4.2", "<0.5", ">= 60", "1,200" → number (with qualifier); text ("Positive") → null */
export function parseResultValue(raw: string | null | undefined): ParsedValue {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  const m = /^(<=|>=|≤|≥|<|>)?\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;
  const q = m[1] === '≤' ? '<=' : m[1] === '≥' ? '>=' : ((m[1] as '<' | '>' | '<=' | '>=' | undefined) ?? null);
  return { num: Number(m[2]), qualifier: q };
}

export type ParsedRange =
  | { kind: 'between'; low: number; high: number }
  | { kind: 'below'; high: number; inclusive: boolean }
  | { kind: 'above'; low: number; inclusive: boolean }
  | { kind: 'qualitative'; normal: string }
  | null;

/** "3.5-5.0", "3.5 – 5.0", "<5.0", "<=200", ">60", "≥ 40", "Negative" */
export function parseReferenceRange(raw: string | null | undefined): ParsedRange {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (!s) return null;
  const between = /^(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)$/i.exec(s);
  if (between) {
    const low = Number(between[1]);
    const high = Number(between[2]);
    return low <= high ? { kind: 'between', low, high } : null;
  }
  const one = /^(<=|>=|≤|≥|<|>)\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (one) {
    const op = one[1];
    const n = Number(one[2]);
    if (op === '<' || op === '<=' || op === '≤') return { kind: 'below', high: n, inclusive: op !== '<' };
    return { kind: 'above', low: n, inclusive: op !== '>' };
  }
  if (/^[a-z][a-z\s/-]*$/i.test(s)) return { kind: 'qualitative', normal: s.toLowerCase() };
  return null;
}

/** Where the value sits relative to a range: -1 below, 0 inside, 1 above; null when not comparable */
function position(v: NonNullable<ParsedValue>, r: Exclude<ParsedRange, null | { kind: 'qualitative' }>): -1 | 0 | 1 | null {
  const x = v.num;
  // Qualified values ("<0.5", ">100") only flag when the side is certain; otherwise not computable
  if (r.kind === 'between') {
    if (v.qualifier === '<' || v.qualifier === '<=') return x <= r.low ? -1 : x <= r.high && r.low <= 0 ? 0 : null;
    if (v.qualifier === '>' || v.qualifier === '>=') return x >= r.high ? 1 : null;
    return x < r.low ? -1 : x > r.high ? 1 : 0;
  }
  if (r.kind === 'below') {
    if (v.qualifier === '<' || v.qualifier === '<=') return x <= r.high ? 0 : null;
    if (r.inclusive ? x > r.high : x >= r.high) return 1;
    return 0;
  }
  // above
  if (v.qualifier === '>' || v.qualifier === '>=') return x >= r.low ? 0 : null;
  if (r.inclusive ? x < r.low : x <= r.low) return -1;
  return 0;
}

const NEGATIVE_WORDS = /^(negative|neg|not detected|none detected|nonreactive|non-reactive|normal|absent|within normal limits|wnl)$/i;
const POSITIVE_WORDS = /^(positive|pos|detected|reactive|present|abnormal)$/i;

/**
 * Flag from the entered value, reference range and (optional) critical range as printed by the lab.
 * Returns null when the flag cannot be computed (no range, text value with a numeric range, …):
 * staff then pick the lab's printed flag.
 */
export function computeAbnormalFlag(
  value: string | null | undefined,
  refRange: string | null | undefined,
  criticalRange?: string | null
): LabResultFlag | null {
  const v = parseResultValue(value);
  const crit = parseReferenceRange(criticalRange);
  if (v && crit && crit.kind !== 'qualitative') {
    const p = position(v, crit);
    // A critical range is the "not critical" band (e.g. 2.5-6.5): outside it is critical
    if (p === -1) return 'LL';
    if (p === 1) return 'HH';
  }
  const ref = parseReferenceRange(refRange);
  if (!ref) return null;
  if (ref.kind === 'qualitative') {
    const text = String(value ?? '').trim();
    if (!text || v) return null;
    if (text.toLowerCase() === ref.normal) return 'N';
    if (NEGATIVE_WORDS.test(ref.normal) && POSITIVE_WORDS.test(text)) return 'A';
    if (NEGATIVE_WORDS.test(ref.normal) && NEGATIVE_WORDS.test(text)) return 'N';
    return null;
  }
  if (!v) return null;
  const p = position(v, ref);
  if (p === null) return null;
  return p === -1 ? 'L' : p === 1 ? 'H' : 'N';
}

/**
 * Final flag: the lab's printed flag when staff chose one, else the computed flag, else N.
 * flagSource records which (shown on the result).
 */
export function resolveResultFlag(input: {
  value: string;
  refRange?: string | null;
  criticalRange?: string | null;
  labFlag?: string | null;
}): { flag: LabResultFlag; flagSource: 'computed' | 'lab' | 'none' } {
  const lab = String(input.labFlag ?? '').trim().toUpperCase();
  if ((LAB_RESULT_FLAGS as readonly string[]).includes(lab)) return { flag: lab as LabResultFlag, flagSource: 'lab' };
  const computed = computeAbnormalFlag(input.value, input.refRange, input.criticalRange);
  if (computed) return { flag: computed, flagSource: 'computed' };
  return { flag: 'N', flagSource: 'none' };
}

/** Numeric value for trending (qualifier dropped), or null */
export function numericResult(value: string | null | undefined): number | null {
  const v = parseResultValue(value);
  return v ? v.num : null;
}
