import { sendSms, type SendSmsResult } from '@/lib/sms/send';

/**
 * STAFF texts (on-call / crisis paging to a staff member's own phone). Not a patient consent path:
 * staff phones are not governed by Client.smsConsent, so these do NOT go through sendPatientSms.
 * They are fixed templates that never carry patient information (no name, initials, MRN, condition
 * or risk detail): the text only says something needs attention; the details are behind sign-in.
 *
 * No caller pages staff by text today (risk alerts reach staff in the app inbox); new paging code
 * uses this module so the content rule holds.
 */

export type StaffAlertKind = 'high_severity_alert' | 'crisis_page' | 'callback_requested';

const STAFF_TEXT: Record<StaffAlertKind, string> = {
  high_severity_alert: 'Altrixs: New high-severity alert. Open Altrixs to review.',
  crisis_page: 'Altrixs: Urgent page. Open Altrixs now.',
  callback_requested: 'Altrixs: A callback is waiting. Open Altrixs to review.',
};

export function staffAlertText(kind: StaffAlertKind): string {
  return STAFF_TEXT[kind];
}

export const STAFF_TEXT_TEMPLATES: readonly string[] = Object.values(STAFF_TEXT);

/** Staff text: fixed template only; the phone is the staff member's own number. */
export async function sendStaffAlertSms(
  input: { to: string; kind: StaffAlertKind },
  send: typeof sendSms = sendSms
): Promise<SendSmsResult> {
  return send({ to: input.to, body: staffAlertText(input.kind), context: `staff-${input.kind}` });
}
