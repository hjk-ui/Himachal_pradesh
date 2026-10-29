import { z } from 'zod';
import { PATIENT_LOCATION_TYPES, type PatientLocationType } from '@/lib/telehealth/pos';

/**
 * Telehealth lobby check-in: what the PATIENT tells us before the visit. Nothing here is
 * defaulted. Before, the check-in route stored clientConsentSigned = true and
 * clientLocationState = 'Maryland' when the browser sent neither, which (a) recorded a consent the
 * patient never gave and (b) asserted the patient was in Maryland for licensure and POS.
 *
 * Required:
 *   - consentSigned === true (an explicit checkbox; false or missing is refused)
 *   - locationType: "Where are you right now?" home | other (drives POS 10 / 02)
 *   - locationState: the US state (or DC / territory) the patient is in now (licensure)
 */

export const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY', 'PR', 'VI', 'GU', 'AS', 'MP',
] as const;

export const telehealthCheckInSchema = z.object({
  consentSigned: z.literal(true, { message: 'Check the consent box to continue' }),
  locationType: z.enum(PATIENT_LOCATION_TYPES as unknown as [PatientLocationType, ...PatientLocationType[]], {
    message: 'Tell us where you are right now',
  }),
  locationState: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => (US_STATE_CODES as readonly string[]).includes(v), 'Choose the state you are in right now'),
});

export type TelehealthCheckIn = z.infer<typeof telehealthCheckInSchema>;

export type CheckInParse =
  | { ok: true; value: TelehealthCheckIn }
  | { ok: false; error: string; field: 'consentSigned' | 'locationType' | 'locationState' | 'body' };

/** Validate a check-in body; the first problem is returned as a patient-facing message. */
export function parseTelehealthCheckIn(body: unknown): CheckInParse {
  const r = telehealthCheckInSchema.safeParse(body ?? {});
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  const key = String(issue?.path?.[0] ?? '');
  const messages = {
    consentSigned: 'Please read and check the telehealth consent box before joining.',
    locationType: 'Please tell us where you are right now (home or another location).',
    locationState: 'Please choose the state you are in right now.',
  } as const;
  if (key in messages) {
    const field = key as keyof typeof messages;
    return { ok: false, field, error: messages[field] };
  }
  return { ok: false, field: 'body', error: 'Please complete the check-in form.' };
}

/** Columns the check-in writes on TelehealthSession (the patient's own answers only). */
export function checkInSessionData(v: TelehealthCheckIn, at: Date = new Date()) {
  return {
    clientConsentSigned: true,
    clientLocationState: v.locationState,
    patientLocationType: v.locationType,
    patientCheckedIn: true,
    patientCheckedInAt: at,
    status: 'CHECKED_IN' as const,
  };
}

/** Columns mirrored onto the linked Appointment so notes / claims see the same location. */
export function checkInAppointmentData(v: TelehealthCheckIn) {
  return { patientLocationType: v.locationType, patientLocationState: v.locationState };
}
