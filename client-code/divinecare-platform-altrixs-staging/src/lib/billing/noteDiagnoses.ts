/**
 * Claim diagnoses from a signed note's service details (ProgressNoteServiceDetail.diagnosisCodes):
 * the clinician's pointer order (first = primary, 837P HI01 / box 21A), at most 12 (837P HI
 * segment / CMS-1500 box 21 A–L), duplicates and malformed codes dropped. Each service line points
 * at the first (up to) 4 diagnoses (837P SV107 / box 24E). Pure (no I/O).
 *
 * Returns null when the note has no usable codes: the claim then keeps the existing behavior
 * (diagnoses entered by billing, client's primary diagnosis in the scrubber).
 */
/** ICD-10-CM shape: letter (not U), digit, digit-or-letter (e.g. F33, M1A), optional .subcode */
const ICD10_RE = /^[A-TV-Z]\d[0-9A-Z](\.[0-9A-Z]{1,4})?$/;

export const MAX_CLAIM_DIAGNOSES = 12;
export const MAX_LINE_POINTERS = 4;

export type NoteClaimDiagnoses = {
  /** ICD-10-CM codes in the clinician's order, primary first (max 12) */
  codes: string[];
  /** 1-based pointers for each service line (max 4) */
  linePointers: number[];
};

export function claimDiagnosesFromNote(codes: readonly (string | null | undefined)[] | null | undefined): NoteClaimDiagnoses | null {
  const out: string[] = [];
  for (const raw of codes ?? []) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!ICD10_RE.test(code) || out.includes(code)) continue;
    out.push(code);
    if (out.length === MAX_CLAIM_DIAGNOSES) break;
  }
  if (!out.length) return null;
  return {
    codes: out,
    linePointers: Array.from({ length: Math.min(MAX_LINE_POINTERS, out.length) }, (_, i) => i + 1),
  };
}
