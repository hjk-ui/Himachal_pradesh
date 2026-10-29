/**
 * Who a measure link can go to, and how (pure). Nothing is ever sent without a delivery channel the
 * patient agreed to:
 *  - email: an email on the chart and no email opt-out
 *  - sms:   Client.smsConsent, no STOP, a number on the chart (the patient SMS gate re-checks all of
 *           it at send time, and SMS may still be unavailable until toll-free registration is done:
 *           that send is recorded "not sent: SMS not available", never as sent)
 * The link asks for the date of birth, so a chart without a DOB cannot get a link.
 *
 * 42 CFR Part 2: substance-use instruments for a Part 2 client go by email / text only when the
 * client's Part 2 consent covers it (signed, unexpired, names the patient / portal / electronic
 * delivery). Otherwise those measures are in-session only and are dropped from the send.
 */
import { emailReminderEligibility, smsEligibility } from '@/lib/sms/consent';
import { isSendable, isSudInstrument } from './instruments';

/**
 * portal: the request is listed in the patient portal (Questionnaires) for an ACTIVE portal login.
 * Only when staff choose it ("Send measure" > Patient portal); automatic sends stay email / text.
 * Open requests sent by email / text are listed in the portal too.
 */
export type DeliveryChannel = 'email' | 'sms' | 'portal';

export type DeliveryClient = {
  dateOfBirth: Date | string | null;
  email: string | null;
  emailOptOutAt: Date | string | null;
  phone: string | null;
  smsConsent: boolean | null;
  smsOptOutAt: Date | string | null;
  /** ACTIVE etc.; deceased clients never get a link */
  status?: string | null;
  deceasedAt?: Date | string | null;
  /** The client has an ACTIVE patient portal login of their own (self, not a proxy) */
  portalActive?: boolean;
};

export type NotSentReason =
  | 'no_measures'
  | 'not_sendable'
  | 'no_dob'
  | 'no_channel'
  | 'inactive_client'
  | 'part2_in_session_only'
  | 'all_channels_failed';

export const NOT_SENT_TEXT: Record<NotSentReason, string> = {
  no_measures: 'Nothing due to send.',
  not_sendable: 'These measures cannot be sent to a patient (clinician-rated or pending licensed copy): give them in session.',
  no_dob: 'Not sent: no date of birth on the chart (the link asks for it before showing anything).',
  no_channel: 'Not sent: no email on file (or opted out), no text-message consent, and no active portal login.',
  inactive_client: 'Not sent: the client is not active.',
  part2_in_session_only: "Not sent: 42 CFR Part 2 — the client's Part 2 consent does not cover sending substance-use measures. Give them in session.",
  all_channels_failed: 'Not sent: every delivery channel failed.',
};

export type DeliveryPlan =
  | { ok: true; instrumentIds: string[]; channels: DeliveryChannel[]; droppedPart2: string[]; droppedNotSendable: string[]; part2: boolean }
  | { ok: false; reason: NotSentReason; droppedPart2: string[]; droppedNotSendable: string[] };

export function planDelivery(input: {
  client: DeliveryClient;
  instrumentIds: string[];
  /** Restrict to these channels (staff "Send now" by email only, for instance) */
  allowed?: DeliveryChannel[];
  part2Client: boolean;
  part2ConsentCovers: boolean;
}): DeliveryPlan {
  const unique = [...new Set(input.instrumentIds)];
  const droppedNotSendable = unique.filter((id) => !isSendable(id));
  let ids = unique.filter(isSendable);
  const droppedPart2 = input.part2Client && !input.part2ConsentCovers ? ids.filter(isSudInstrument) : [];
  ids = ids.filter((id) => !droppedPart2.includes(id));
  const fail = (reason: NotSentReason): DeliveryPlan => ({ ok: false, reason, droppedPart2, droppedNotSendable });
  if (!unique.length) return fail('no_measures');
  if (!ids.length) return fail(droppedPart2.length ? 'part2_in_session_only' : 'not_sendable');
  const c = input.client;
  if (c.deceasedAt || (c.status && c.status !== 'ACTIVE')) return fail('inactive_client');
  if (!c.dateOfBirth) return fail('no_dob');
  const allowed = new Set(input.allowed ?? ['email', 'sms']);
  const channels: DeliveryChannel[] = [];
  if (allowed.has('email') && emailReminderEligibility({ email: c.email, emailOptOutAt: c.emailOptOutAt }).ok) channels.push('email');
  if (allowed.has('sms') && smsEligibility({ phone: c.phone, smsConsent: c.smsConsent, smsOptOutAt: c.smsOptOutAt }).ok) channels.push('sms');
  if (allowed.has('portal') && c.portalActive) channels.push('portal');
  if (!channels.length) return fail('no_channel');
  return { ok: true, instrumentIds: ids, channels, droppedPart2, droppedNotSendable, part2: input.part2Client && ids.some(isSudInstrument) };
}

/** Part 2 consent covering electronic delivery to the patient (same rule the AI scribe uses for the portal) */
export function part2ConsentCoversPatient(rows: { type: string | null; formKey?: string | null; recipientName?: string | null }[]): boolean {
  return rows.some((r) => {
    const label = `${r.type ?? ''} ${r.recipientName ?? ''}`;
    const isPart2 = r.formKey === 'lib:part2-consent' || /42\s*cfr|part\s*2/i.test(r.type ?? '');
    return isPart2 && /portal|patient|self|electronic|email|text/i.test(label);
  });
}
