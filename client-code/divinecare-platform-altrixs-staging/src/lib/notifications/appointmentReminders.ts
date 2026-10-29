import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatPracticeDate, formatPracticeTime } from '@/lib/time/practiceTime';
import { smsEligibility, emailReminderEligibility, type SmsConsentFields } from '@/lib/sms/consent';

/**
 * Appointment reminders over SMS and email (push stays in triggers/appointmentScheduler.ts).
 *
 * Settings (Admin > Scheduling, SchedulingSettings.remindersJson):
 *   smsReminder24h, smsReminder2h, emailReminder24h. All off = nothing is sent.
 * Eligibility:
 *   SMS   - Client.smsConsent true, no smsOptOutAt, phone on file (src/lib/sms/consent.ts)
 *   email - email on file, no emailOptOutAt
 * Dedupe + log: one NotificationLog row per appointment x channel x window (dedupeKey unique),
 *   status sent | failed | skipped with a reason. A skipped / failed reminder is not retried.
 * Content (minimum necessary): practice name, date, time. Never the clinician's name, the visit
 *   type, the client's name, or a join link on SMS. SMS ends with CTIA opt-out wording.
 */

export type ReminderWindow = '24h' | '2h';
export type ReminderChannel = 'sms' | 'email';

/** Minutes before start that each window covers. Wider than the cron interval (run every 10 min). */
export const REMINDER_WINDOWS: Record<ReminderWindow, { minMinutes: number; maxMinutes: number }> = {
  '24h': { minMinutes: 23 * 60, maxMinutes: 25 * 60 },
  '2h': { minMinutes: 100, maxMinutes: 140 },
};

export type ReminderSettings = { smsReminder24h: boolean; smsReminder2h: boolean; emailReminder24h: boolean };

export function windowFor(startsAt: Date, now: Date): ReminderWindow | null {
  const mins = (startsAt.getTime() - now.getTime()) / 60_000;
  for (const [w, r] of Object.entries(REMINDER_WINDOWS) as [ReminderWindow, { minMinutes: number; maxMinutes: number }][]) {
    if (mins >= r.minMinutes && mins <= r.maxMinutes) return w;
  }
  return null;
}

export function channelEnabled(settings: ReminderSettings, channel: ReminderChannel, window: ReminderWindow): boolean {
  if (channel === 'sms') return window === '24h' ? settings.smsReminder24h : settings.smsReminder2h;
  return window === '24h' ? settings.emailReminder24h : false;
}

export function reminderDedupeKey(appointmentId: string, channel: ReminderChannel, window: ReminderWindow) {
  return `appt-reminder:${appointmentId}:${channel}:${window}`;
}

export type ReminderClient = SmsConsentFields & { email?: string | null; emailOptOutAt?: Date | string | null };

export type ReminderDecision =
  | { send: true }
  | { send: false; reason: 'setting_off' | 'no_phone' | 'no_sms_consent' | 'sms_opted_out' | 'no_email' | 'email_opted_out' };

export function reminderDecision(
  settings: ReminderSettings,
  channel: ReminderChannel,
  window: ReminderWindow,
  client: ReminderClient
): ReminderDecision {
  if (!channelEnabled(settings, channel, window)) return { send: false, reason: 'setting_off' };
  const e = channel === 'sms' ? smsEligibility(client) : emailReminderEligibility(client);
  if (e.ok === false) return { send: false, reason: e.reason };
  return { send: true };
}

function cleanPracticeName(name: string | null | undefined): string {
  const n = (name ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
  return n || 'your care team';
}

/** "Mon Oct 19" and "9:00 AM ET" on the practice clock. */
export function reminderDateTime(startsAt: Date, timeZone: string) {
  const date = formatPracticeDate(startsAt, timeZone, { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,/g, '');
  const time = formatPracticeTime(startsAt, timeZone, { withZone: true });
  return { date, time };
}

/** SMS reminder. CTIA: sender identified, opt-out instruction. No clinician, visit type or link. */
export function reminderSmsText(opts: { practiceName: string | null | undefined; startsAt: Date; timeZone: string }): string {
  const { date, time } = reminderDateTime(opts.startsAt, opts.timeZone);
  return `Reminder: you have an appointment with ${cleanPracticeName(opts.practiceName)} on ${date} at ${time}. Reply C to confirm, STOP to opt out.`;
}

function escapeHtml(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Email reminder: date, time, in person vs telehealth, portal link, one-click unsubscribe. */
export function reminderEmail(opts: {
  practiceName: string | null | undefined;
  startsAt: Date;
  timeZone: string;
  isVirtual: boolean;
  portalUrl: string;
  unsubscribeUrl: string;
  contactPhone?: string | null;
}) {
  const practice = cleanPracticeName(opts.practiceName);
  const { date, time } = reminderDateTime(opts.startsAt, opts.timeZone);
  const how = opts.isVirtual ? 'Telehealth (video) visit. Join from your patient portal.' : 'In-office visit.';
  const call = opts.contactPhone?.trim() ? ` To reschedule, call ${opts.contactPhone.trim()}.` : '';
  const subject = `Appointment reminder: ${date} at ${time}`;
  const text = [
    `This is a reminder of your appointment with ${practice} on ${date} at ${time}.`,
    how,
    `Details: ${opts.portalUrl}`,
    call.trim(),
    '',
    `Stop appointment reminder emails: ${opts.unsubscribeUrl}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
  const html = `<p>This is a reminder of your appointment with <strong>${escapeHtml(practice)}</strong> on <strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>.</p>
<p>${escapeHtml(how)}</p>
<p><a href="${escapeHtml(opts.portalUrl)}">Open your patient portal</a> for details.${escapeHtml(call)}</p>
<p style="font-size:12px;color:#666"><a href="${escapeHtml(opts.unsubscribeUrl)}">Unsubscribe from appointment reminder emails</a></p>`;
  return {
    subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${opts.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

// ── One-click unsubscribe token (HMAC of the client id; no PHI in the URL) ───────────────

function unsubscribeSecret(): string {
  const s =
    process.env.UNSUBSCRIBE_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error('UNSUBSCRIBE_SECRET (or AUTH_SECRET) is not set');
  return s;
}

function sig(clientId: string, secret: string) {
  return createHmac('sha256', secret).update(`email-unsub:${clientId}`).digest('base64url');
}

export function unsubscribeToken(clientId: string, secret: string = unsubscribeSecret()): string {
  return `${Buffer.from(clientId, 'utf8').toString('base64url')}.${sig(clientId, secret)}`;
}

/** Client id from a valid token, else null. */
export function readUnsubscribeToken(token: string | null | undefined, secret: string = unsubscribeSecret()): string | null {
  if (!token || typeof token !== 'string') return null;
  const [idPart, mac] = token.split('.');
  if (!idPart || !mac) return null;
  let clientId: string;
  try {
    clientId = Buffer.from(idPart, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!clientId || clientId.length > 64) return null;
  const want = Buffer.from(sig(clientId, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return clientId;
}
