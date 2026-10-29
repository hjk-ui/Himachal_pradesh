import { OPT_OUT_FOOTER } from '@/lib/sms/contentRules';

/**
 * Patient text templates (pure). Sender is already resolved by the gate (smsSender: practice name
 * only when the practice allows it, else "Your care team"). Every template is scanned by
 * lintPatientSms in tests/sms-patient-gate.test.ts: no clinician, visit type, condition, balance,
 * result or client name; opt-out wording on everything except a one-time security code.
 * Appointment confirmations: src/patient/infrastructure/notifications/templates.ts; reminders:
 * src/lib/notifications/appointmentReminders.ts; statements: src/lib/billing/statementSms.ts.
 */

const clean = (s: string | null | undefined) => (s ?? '').replace(/[\r\n\t]+/g, ' ').trim();

export function telehealthScheduledSms(input: { sender: string; date: string; time: string; joinUrl?: string | null }): string {
  const join = input.joinUrl ? ` Join: ${input.joinUrl}` : ' Join from your patient portal.';
  return `${clean(input.sender)}: Your video visit is scheduled for ${clean(input.date)} at ${clean(input.time)}.${join} ${OPT_OUT_FOOTER}`;
}

export function telehealthReadySms(input: { sender: string; joinUrl: string }): string {
  return `${clean(input.sender)}: Your video visit is ready. Join: ${input.joinUrl} ${OPT_OUT_FOOTER}`;
}

/** Lab release and any other "something is waiting in the portal" notice: says nothing about what. */
export function portalNoticeSms(input: { sender: string }): string {
  return `${clean(input.sender)}: You have a new message in your patient portal. Please sign in to view it. ${OPT_OUT_FOOTER}`;
}

export function portalInviteSms(input: { sender: string; acceptUrl: string }): string {
  return `${clean(input.sender)}: Set up your patient portal account (link expires in 7 days): ${input.acceptUrl} ${OPT_OUT_FOOTER}`;
}

/** Forms waiting in the portal (consent packet): never names the forms; the link is the portal sign-in. */
export function documentsToSignSms(input: { sender: string; portalUrl: string }): string {
  return `${clean(input.sender)}: You have forms to review and sign in your patient portal: ${input.portalUrl} ${OPT_OUT_FOOTER}`;
}

/** Questionnaire before a visit: never names the questionnaire or the visit type; the link asks for date of birth first. */
export function measureRequestSms(input: { sender: string; url: string }): string {
  return `${clean(input.sender)}: You have a short questionnaire to complete before your visit: ${input.url} ${OPT_OUT_FOOTER}`;
}

/** One-time code the patient asked for (no opt-out footer: transactional, patient-initiated). */
export function securityCodeSms(input: { code: string }): string {
  return `Your verification code is ${input.code.replace(/\D/g, '').slice(0, 8)}. It expires in 2 minutes. Do not share it.`;
}

/** Staff free text: opt-out wording appended when the staff member left it out. */
export function withOptOutFooter(body: string): string {
  const b = body.trim();
  return /\bSTOP\b[^.]*opt.?out/i.test(b) ? b : `${b} ${OPT_OUT_FOOTER}`;
}
