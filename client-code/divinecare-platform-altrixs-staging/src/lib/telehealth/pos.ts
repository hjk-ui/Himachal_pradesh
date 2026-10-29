/**
 * Telehealth place of service (CMS POS code set): one helper for every route that writes a POS
 * (telehealth end, in-call end-session, claim submissionData).
 *
 *   POS 10 = telehealth provided in the patient's home
 *   POS 02 = telehealth provided other than in the patient's home
 *
 * The POS follows where the PATIENT is during the visit (asked at telehealth check-in), mapped
 * through practice settings posTelehealthHome / posTelehealthOther. A POS is always the bare
 * two-digit code: "POS 02" in an 837P SV105 / 2300 CLM05-1 is rejected by the payer.
 *
 * When the patient's location is unknown and staff did not record one, the result is null: the
 * claim must be held for a POS, never filled with a guess.
 */

export type PatientLocationType = 'home' | 'other';

export const PATIENT_LOCATION_TYPES: readonly PatientLocationType[] = ['home', 'other'] as const;

export const TELEHEALTH_POS_CODES = ['02', '10'] as const;
export type TelehealthPosCode = (typeof TELEHEALTH_POS_CODES)[number];

export type TelehealthPosSettings = {
  posTelehealthHome?: string | null;
  posTelehealthOther?: string | null;
};

/** Bare two-digit telehealth POS from "02", "2", "POS 02", "pos-10"; null for anything else. */
export function normalizeTelehealthPos(raw: unknown): TelehealthPosCode | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).trim().replace(/^pos[\s:_-]*/i, '');
  if (!/^\d{1,2}$/.test(digits)) return null;
  const code = digits.padStart(2, '0');
  return (TELEHEALTH_POS_CODES as readonly string[]).includes(code) ? (code as TelehealthPosCode) : null;
}

export function isPatientLocationType(v: unknown): v is PatientLocationType {
  return v === 'home' || v === 'other';
}

export type TelehealthPosResult = {
  /** Two-digit code, or null when it cannot be known (hold the claim). */
  pos: TelehealthPosCode | null;
  /** patient_location: from check-in; staff_entered: chosen by staff in the visit; unknown: neither. */
  source: 'patient_location' | 'staff_entered' | 'unknown';
};

/**
 * POS for a telehealth visit. The patient's own check-in answer wins; a staff-entered code is used
 * only when the patient's location was not captured (e.g. an audio-only visit where staff asked).
 */
export function resolveTelehealthPos(input: {
  patientLocationType?: string | null;
  staffPos?: unknown;
  settings?: TelehealthPosSettings | null;
}): TelehealthPosResult {
  const home = normalizeTelehealthPos(input.settings?.posTelehealthHome) ?? '10';
  const other = normalizeTelehealthPos(input.settings?.posTelehealthOther) ?? '02';
  if (isPatientLocationType(input.patientLocationType)) {
    return { pos: input.patientLocationType === 'home' ? home : other, source: 'patient_location' };
  }
  const staff = normalizeTelehealthPos(input.staffPos);
  if (staff) return { pos: staff, source: 'staff_entered' };
  return { pos: null, source: 'unknown' };
}
