/**
 * TCPA gate for every text to a patient. A text goes out only when ALL hold:
 *   - Client.smsConsent is true (express consent captured at intake / portal / by staff, with source)
 *   - Client.smsOptOutAt is null (an inbound STOP sets it; START clears it)
 *   - the client has a phone number
 * Push notifications and email have their own rules; this is SMS only.
 */

export type SmsConsentFields = {
  phone?: string | null;
  smsConsent?: boolean | null;
  smsOptOutAt?: Date | string | null;
};

export type SmsSkipReason = 'no_phone' | 'no_sms_consent' | 'sms_opted_out';

export function smsEligibility(c: SmsConsentFields): { ok: true } | { ok: false; reason: SmsSkipReason } {
  if (c.smsOptOutAt) return { ok: false, reason: 'sms_opted_out' };
  if (!c.smsConsent) return { ok: false, reason: 'no_sms_consent' };
  if (!c.phone?.trim()) return { ok: false, reason: 'no_phone' };
  return { ok: true };
}

export function canTextClient(c: SmsConsentFields): boolean {
  return smsEligibility(c).ok;
}

export type EmailConsentFields = { email?: string | null; emailOptOutAt?: Date | string | null };

export function emailReminderEligibility(c: EmailConsentFields): { ok: true } | { ok: false; reason: 'no_email' | 'email_opted_out' } {
  if (c.emailOptOutAt) return { ok: false, reason: 'email_opted_out' };
  if (!c.email?.trim()) return { ok: false, reason: 'no_email' };
  return { ok: true };
}
