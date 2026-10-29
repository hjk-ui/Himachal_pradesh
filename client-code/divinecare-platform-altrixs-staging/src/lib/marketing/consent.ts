/**
 * Marketing consent gate (pure). Every marketing / lead message goes through decideSend before it
 * is handed to SES or End User Messaging (src/lib/marketing/send.ts). Separate from the clinical
 * patient SMS gate (src/lib/sms/patientSms.ts): treatment reminders never come through here.
 *
 * Rules
 *  - SMS (TCPA): explicit SMS consent on THIS record, no STOP / opt-out, valid number, outside
 *    quiet hours (recipient local time = practice time zone). Quiet hours defer, never drop.
 *  - Email (CAN-SPAM, practice stricter): marketing email needs opt-in, no unsubscribe on file, and
 *    a physical postal address configured. A lead's own inquiry follow-up needs contact consent.
 *  - Clients (HIPAA 164.508(a)(3)): any marketing to a client needs a signed, unexpired, unrevoked
 *    marketing authorization. Leads already converted to clients are treated as clients.
 *  - inquiry_reply: one reply to a message the person just sent us (auto-reply / missed call);
 *    still refused after STOP.
 */
import { DAYS, DEFAULT_QUIET_HOURS, type BusinessHours } from './constants';

export type SendChannel = 'sms' | 'email';
/** lead_follow_up: about the lead's own inquiry. marketing: campaigns, newsletters, review requests. */
export type SendPurpose = 'lead_follow_up' | 'marketing' | 'inquiry_reply';

export type ConsentRecipient = {
  phone?: string | null;
  email?: string | null;
  contactConsent?: boolean | null;
  smsConsent?: boolean | null;
  smsOptOutAt?: Date | string | null;
  emailConsent?: boolean | null;
  emailOptOutAt?: Date | string | null;
  /** Lead converted to a client, or a contact linked to a client */
  isClient?: boolean;
  marketingAuthorizationAt?: Date | string | null;
  marketingAuthorizationExpiresAt?: Date | string | null;
  marketingAuthorizationRevokedAt?: Date | string | null;
  /** inquiry_reply only: when the person last messaged / called us */
  lastInboundAt?: Date | string | null;
};

export type SendContext = {
  now: Date;
  timeZone?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  physicalAddress?: string | null;
};

export type BlockReason =
  | 'no_phone'
  | 'invalid_phone'
  | 'no_email'
  | 'no_sms_consent'
  | 'sms_opted_out'
  | 'no_email_consent'
  | 'email_opted_out'
  | 'no_contact_consent'
  | 'no_marketing_authorization'
  | 'marketing_authorization_expired'
  | 'marketing_authorization_revoked'
  | 'no_physical_address'
  | 'quiet_hours'
  | 'no_recent_inbound';

export type SendDecision = { ok: true; to: string; reason?: undefined; deferUntil?: undefined } | { ok: false; reason: BlockReason; deferUntil?: Date; to?: undefined };

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  no_phone: 'No mobile number on file.',
  invalid_phone: 'The phone number is not a valid US mobile number.',
  no_email: 'No email address on file.',
  no_sms_consent: 'No SMS consent on file. Texts need explicit consent (TCPA).',
  sms_opted_out: 'This number opted out (STOP). No more texts.',
  no_email_consent: 'No email opt-in on file for marketing email.',
  email_opted_out: 'This address unsubscribed.',
  no_contact_consent: 'The person has not agreed to be contacted about their inquiry.',
  no_marketing_authorization: 'Client without a signed marketing authorization (HIPAA). Not sent.',
  marketing_authorization_expired: 'The marketing authorization expired.',
  marketing_authorization_revoked: 'The marketing authorization was revoked.',
  no_physical_address: 'Add the practice postal address in Settings (CAN-SPAM) before sending marketing email.',
  quiet_hours: 'Quiet hours: the text will wait until the morning.',
  no_recent_inbound: 'Auto-replies only answer a message received in the last 24 hours.',
};

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** US E.164 (+1XXXXXXXXXX) or null. */
export function toUsE164(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1') && /^[2-9]/.test(d.slice(1))) return `+${d}`;
  return null;
}

export function isValidEmail(email: string | null | undefined): boolean {
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()));
}

function hhmm(s: string | undefined, fallback: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '') ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes after midnight in a time zone. */
export function localMinutes(now: Date, timeZone = 'America/New_York'): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** In quiet hours? Window may wrap midnight (20:00 -> 09:00). Returns when it ends. */
export function quietHoursState(ctx: SendContext): { quiet: boolean; endsAt: Date | null } {
  const start = hhmm(ctx.quietHoursStart, DEFAULT_QUIET_HOURS.start);
  const end = hhmm(ctx.quietHoursEnd, DEFAULT_QUIET_HOURS.end);
  if (start === end) return { quiet: false, endsAt: null };
  const cur = localMinutes(ctx.now, ctx.timeZone);
  const quiet = start < end ? cur >= start && cur < end : cur >= start || cur < end;
  if (!quiet) return { quiet: false, endsAt: null };
  const minutesLeft = (end - cur + 24 * 60) % (24 * 60);
  return { quiet: true, endsAt: new Date(ctx.now.getTime() + minutesLeft * 60000) };
}

/** Marketing authorization usable now? */
export function marketingAuthorizationState(r: ConsentRecipient, now: Date): 'valid' | 'missing' | 'expired' | 'revoked' {
  if (!asDate(r.marketingAuthorizationAt)) return 'missing';
  if (asDate(r.marketingAuthorizationRevokedAt)) return 'revoked';
  const exp = asDate(r.marketingAuthorizationExpiresAt);
  if (exp && exp.getTime() < now.getTime()) return 'expired';
  return 'valid';
}

export function decideSend(r: ConsentRecipient, channel: SendChannel, purpose: SendPurpose, ctx: SendContext): SendDecision {
  // HIPAA: a client never gets marketing without a valid authorization (any channel)
  if (r.isClient && purpose === 'marketing') {
    const a = marketingAuthorizationState(r, ctx.now);
    if (a === 'missing') return { ok: false, reason: 'no_marketing_authorization' };
    if (a === 'revoked') return { ok: false, reason: 'marketing_authorization_revoked' };
    if (a === 'expired') return { ok: false, reason: 'marketing_authorization_expired' };
  }
  // A converted lead is a client: follow-ups move to the clinical system
  if (r.isClient && purpose !== 'marketing') return { ok: false, reason: 'no_marketing_authorization' };

  if (purpose === 'inquiry_reply') {
    const last = asDate(r.lastInboundAt);
    if (!last || ctx.now.getTime() - last.getTime() > 24 * 60 * 60 * 1000) return { ok: false, reason: 'no_recent_inbound' };
  }

  if (channel === 'sms') {
    if (!r.phone?.trim()) return { ok: false, reason: 'no_phone' };
    const to = toUsE164(r.phone);
    if (!to) return { ok: false, reason: 'invalid_phone' };
    if (asDate(r.smsOptOutAt)) return { ok: false, reason: 'sms_opted_out' };
    if (purpose !== 'inquiry_reply' && !r.smsConsent) return { ok: false, reason: 'no_sms_consent' };
    if (purpose !== 'inquiry_reply') {
      const q = quietHoursState(ctx);
      if (q.quiet) return { ok: false, reason: 'quiet_hours', deferUntil: q.endsAt ?? undefined };
    }
    return { ok: true, to };
  }

  // email
  if (!r.email?.trim() || !isValidEmail(r.email)) return { ok: false, reason: 'no_email' };
  if (asDate(r.emailOptOutAt)) return { ok: false, reason: 'email_opted_out' };
  if (purpose === 'marketing') {
    if (!r.emailConsent) return { ok: false, reason: 'no_email_consent' };
    if (!ctx.physicalAddress?.trim()) return { ok: false, reason: 'no_physical_address' };
  } else if (purpose === 'lead_follow_up') {
    if (!r.contactConsent && !r.emailConsent) return { ok: false, reason: 'no_contact_consent' };
  }
  return { ok: true, to: r.email.trim().toLowerCase() };
}

/** SMS body with the opt-out footer (added once). */
export function withSmsFooter(body: string): string {
  const t = body.trim();
  return /reply stop/i.test(t) ? t : `${t} Reply STOP to opt out.`;
}

/** CAN-SPAM footer for marketing email (text). */
export function emailFooterText(opts: { practiceName: string; physicalAddress: string; unsubscribeUrl: string }): string {
  return [
    '',
    '--',
    `${opts.practiceName}, ${opts.physicalAddress}`,
    `Unsubscribe: ${opts.unsubscribeUrl}`,
    'If you are in crisis, call or text 988.',
  ].join('\n');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function emailHtml(body: string, opts: { practiceName: string; physicalAddress: string; unsubscribeUrl: string }): string {
  const paras = escapeHtml(body.trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;max-width:560px">${paras}<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"><p style="font-size:12px;color:#64748b;margin:0 0 6px">${escapeHtml(opts.practiceName)}, ${escapeHtml(opts.physicalAddress)}</p><p style="font-size:12px;color:#64748b;margin:0 0 6px"><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#5C2D91">Unsubscribe</a></p><p style="font-size:12px;color:#64748b;margin:0">If you are in crisis, call or text 988.</p></div>`;
}

/** Fill {{tokens}} in a template. Only non-PHI tokens are supported (first name, practice, links). */
export const TEMPLATE_TOKENS = ['firstName', 'practiceName', 'practicePhone', 'bookingLink', 'eventName', 'eventDate', 'reviewLink'] as const;
export function renderTemplate(body: string, vars: Partial<Record<(typeof TEMPLATE_TOKENS)[number], string | null | undefined>>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
    const v = (vars as Record<string, string | null | undefined>)[k];
    return v == null ? '' : String(v);
  }).replace(/[ \t]{2,}/g, ' ').trim();
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Inside business hours right now (practice time zone)? A day set to null is closed. */
export function withinBusinessHours(hours: BusinessHours, timeZone: string, now: Date): boolean {
  const idx = WEEKDAY_SHORT.indexOf(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now));
  const h = hours[DAYS[idx < 0 ? now.getDay() : idx]];
  if (!h) return false;
  const cur = localMinutes(now, timeZone);
  const toMin = (s: string) => {
    const [a, b] = s.split(':').map(Number);
    return a * 60 + (b || 0);
  };
  return cur >= toMin(h.open) && cur < toMin(h.close);
}
