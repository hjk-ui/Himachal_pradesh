/**
 * Crisis resources: one wording for staff banners and the patient portal. Browser-safe.
 * Verified Oct 2026 against 988lifeline.org ("Call", "Text" 988, chat at chat.988lifeline.org)
 * and crisistextline.org ("Text HOME to 741741 … 24/7, free, confidential"; HOLA for Spanish).
 */

export const CRISIS_RESOURCES = {
  lifeline: {
    label: '988 Suicide & Crisis Lifeline',
    detail: 'Call or text 988, or chat at chat.988lifeline.org — 24/7, free and confidential.',
    tel: 'tel:988',
    sms: 'sms:988',
    url: 'https://chat.988lifeline.org/',
  },
  emergency: {
    label: 'Emergency',
    detail: 'If you are in immediate danger or might act on these thoughts, call 911 or go to the nearest emergency room.',
    tel: 'tel:911',
  },
  textLine: {
    label: 'Crisis Text Line',
    detail: 'Text HOME to 741741 (HOLA for Spanish) — 24/7, free and confidential.',
    sms: 'sms:741741?&body=HOME',
  },
} as const;

/** Shown to the patient in the portal right after a message that triggers a HIGH flag. */
export const PATIENT_CRISIS_MESSAGE =
  'Your care team will see your message, but messages are not monitored around the clock. If you are thinking about hurting yourself or someone else, or you are not safe, please reach out now:';

export type PatientSafetyPayload = {
  show: true;
  level: 'high' | 'medium';
  title: string;
  message: string;
  resources: typeof CRISIS_RESOURCES;
};

/** Patient-facing payload: resources only, never the matched words or a clinical label. */
export function patientSafetyPayload(level: 'high' | 'medium'): PatientSafetyPayload {
  return {
    show: true,
    level,
    title: level === 'high' ? 'Help is available right now' : 'Support is available any time',
    message: PATIENT_CRISIS_MESSAGE,
    resources: CRISIS_RESOURCES,
  };
}

/** Text a staff member can read or send to the client (copied by hand; never sent automatically). */
export const STAFF_988_REMINDER =
  'If you are thinking about suicide or are in crisis, you can call or text 988 (Suicide & Crisis Lifeline) any time, or chat at chat.988lifeline.org. You can also text HOME to 741741 (Crisis Text Line). If you are in immediate danger, call 911 or go to the nearest emergency room.';
