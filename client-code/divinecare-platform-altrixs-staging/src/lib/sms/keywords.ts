/**
 * Inbound SMS keywords (TCPA / CTIA Messaging Principles; FCC 2024 revocation rule, effective
 * April 2025: any reasonable opt-out wording must be honored, so the stop list is generous).
 *
 * Matching is on the whole message, trimmed, case-insensitive, trailing punctuation ignored:
 * "Stop", "STOP.", " stop " all opt out. A sentence that merely contains "stop" is "other" and is
 * left for staff (never auto-handled), except the explicit phrases below.
 *
 * NOTE: "CANCEL" is a CTIA opt-out keyword, so reminders say "Reply C to confirm" and never
 * "Reply CANCEL to cancel your visit".
 */

export type SmsKeyword = 'stop' | 'unstop' | 'help' | 'confirm' | 'other';

const STOP = new Set([
  'stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout', 'opt out', 'opt-out',
  'remove', 'remove me', 'stop texting', 'stop texting me', 'do not text', "don't text me", 'dont text me', 'leave me alone',
]);
const UNSTOP = new Set(['start', 'unstop', 'resume', 'opt in', 'optin', 'opt-in']);
const HELP = new Set(['help', 'info']);
const CONFIRM = new Set(['c', 'confirm', 'confirmed']);

export function normalizeKeywordText(body: string | null | undefined): string {
  return (body ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:\s]+$/g, '')
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function parseSmsKeyword(body: string | null | undefined): SmsKeyword {
  const t = normalizeKeywordText(body);
  if (!t) return 'other';
  if (STOP.has(t)) return 'stop';
  if (UNSTOP.has(t)) return 'unstop';
  if (HELP.has(t)) return 'help';
  if (CONFIRM.has(t)) return 'confirm';
  return 'other';
}

/** HELP auto-reply (CTIA: program name, help contact, frequency, rates, opt-out). No PHI. */
export function helpReplyText(opts: { practiceName: string; contactPhone?: string | null }): string {
  const contact = opts.contactPhone?.trim() ? ` Call ${opts.contactPhone.trim()} for help.` : '';
  return `${opts.practiceName}: appointment reminders.${contact} Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`;
}

/** STOP confirmation (one final message is allowed). No PHI. */
export function stopReplyText(practiceName: string): string {
  return `${practiceName}: You are unsubscribed and will receive no more texts. Reply START to resubscribe.`;
}

export function unstopReplyText(practiceName: string): string {
  return `${practiceName}: You are resubscribed to appointment reminders. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

export function confirmReplyText(practiceName: string): string {
  return `${practiceName}: Thanks, your appointment is confirmed.`;
}
