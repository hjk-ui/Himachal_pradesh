/**
 * Substance use disorder (SUD) diagnosis detection for 42 CFR Part 2 handling.
 * ICD-10-CM F10–F19 are SUD codes. F17 (nicotine/tobacco) is not treated as a Part 2 diagnosis here.
 */
const SUD_PREFIX = /^F1[0-689]/i;

export function isSudDiagnosisCode(code: string | null | undefined): boolean {
  return SUD_PREFIX.test((code || '').trim());
}
