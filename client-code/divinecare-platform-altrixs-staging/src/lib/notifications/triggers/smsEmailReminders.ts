import { prisma } from '@/lib/db/prisma';
import { sendSms } from '@/lib/sms/send';
import { sendEmail } from '@/lib/mail/sendEmail';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { getOrCreateSchedulingSettings } from '@/lib/scheduling/manage';
import { getAppBaseUrl } from '@/lib/staff/invite';
import {
  REMINDER_WINDOWS,
  reminderDecision,
  reminderDedupeKey,
  reminderEmail,
  reminderSmsText,
  unsubscribeToken,
  windowFor,
  type ReminderChannel,
  type ReminderSettings,
} from '@/lib/notifications/appointmentReminders';

/**
 * SMS + email appointment reminders, run by /api/cron/notifications (every 10 minutes; see
 * PATIENT texts: consent-gated by reminderDecision -> smsEligibility (src/lib/sms/consent.ts), the
 * same rule as sendPatientSms; this cron keeps its own claim-before-send NotificationLog dedupe.
 * docs/ops-cron.md). Per appointment x channel x window: one NotificationLog row
 * (sent | failed | skipped + reason). Dedupe is the unique dedupeKey, claimed BEFORE sending, so
 * overlapping cron runs never double-text.
 */

export type SmsEmailReminderResult = {
  checked: number;
  sms: { sent: number; failed: number; skipped: number };
  email: { sent: number; failed: number; skipped: number };
  errors: string[];
};

export type ReminderDeps = {
  db: any;
  sendSms: typeof sendSms;
  sendEmail: typeof sendEmail;
  timeZone: (orgId: string | null) => Promise<string>;
  orgSettings: (orgId: string) => Promise<{
    reminders: ReminderSettings & { smsShowPracticeName?: boolean };
    practiceName: string | null;
    contactPhone: string | null;
  }>;
  baseUrl: () => string;
};

const defaultDeps = (): ReminderDeps => ({
  db: prisma,
  sendSms,
  sendEmail,
  timeZone: (orgId) => getPracticeTimeZone(orgId),
  orgSettings: async (orgId) => {
    const s = await getOrCreateSchedulingSettings(orgId);
    return { reminders: s.reminders, practiceName: s.practiceName, contactPhone: s.contactPhone };
  },
  baseUrl: () => getAppBaseUrl(),
});

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === 'P2002';

export async function runSmsEmailReminders(now: Date = new Date(), deps: ReminderDeps = defaultDeps()): Promise<SmsEmailReminderResult> {
  const result: SmsEmailReminderResult = {
    checked: 0,
    sms: { sent: 0, failed: 0, skipped: 0 },
    email: { sent: 0, failed: 0, skipped: 0 },
    errors: [],
  };
  const { db } = deps;
  const earliest = Math.min(...Object.values(REMINDER_WINDOWS).map((w) => w.minMinutes));
  const latest = Math.max(...Object.values(REMINDER_WINDOWS).map((w) => w.maxMinutes));

  let appointments: any[];
  try {
    appointments = await db.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        organizationId: { not: null },
        startsAt: { gte: new Date(now.getTime() + earliest * 60_000), lte: new Date(now.getTime() + latest * 60_000) },
      },
      select: {
        id: true,
        organizationId: true,
        clientId: true,
        startsAt: true,
        isVirtual: true,
        client: {
          select: { id: true, phone: true, email: true, smsConsent: true, smsOptOutAt: true, emailOptOutAt: true },
        },
      },
    });
  } catch (err) {
    result.errors.push(err instanceof Error ? err.name : 'reminder query failed');
    return result;
  }
  result.checked = appointments.length;

  const orgCache = new Map<string, Awaited<ReturnType<ReminderDeps['orgSettings']>> & { timeZone: string }>();

  for (const appt of appointments) {
    const window = windowFor(appt.startsAt, now);
    if (!window || !appt.organizationId) continue;
    let org = orgCache.get(appt.organizationId);
    if (!org) {
      org = { ...(await deps.orgSettings(appt.organizationId)), timeZone: await deps.timeZone(appt.organizationId) };
      orgCache.set(appt.organizationId, org);
    }

    for (const channel of ['sms', 'email'] as ReminderChannel[]) {
      const decision = reminderDecision(org.reminders, channel, window, appt.client);
      if (decision.send === false && decision.reason === 'setting_off') continue; // not logged: practice turned it off
      const dedupeKey = reminderDedupeKey(appt.id, channel, window);
      // Texts name the practice only when the practice allows it (else "your care team")
      const smsPracticeName = org.reminders.smsShowPracticeName === false ? null : org.practiceName;
      const smsText = channel === 'sms' ? reminderSmsText({ practiceName: smsPracticeName, startsAt: appt.startsAt, timeZone: org.timeZone }) : null;
      const email =
        channel === 'email'
          ? reminderEmail({
              practiceName: org.practiceName,
              startsAt: appt.startsAt,
              timeZone: org.timeZone,
              isVirtual: appt.isVirtual,
              portalUrl: `${deps.baseUrl()}/patient`,
              unsubscribeUrl: `${deps.baseUrl()}/api/notifications/unsubscribe?t=${encodeURIComponent(unsubscribeToken(appt.clientId))}`,
              contactPhone: org.contactPhone,
            })
          : null;

      // Claim the reminder first (unique dedupeKey); a concurrent run or an earlier one wins.
      try {
        await db.notificationLog.create({
          data: {
            clientId: appt.clientId,
            appointmentId: appt.id,
            type: 'appointment_reminder',
            channel,
            dedupeKey,
            title: `Appointment reminder (${window})`,
            // Never the message text (date / time / practice tied to a client is PHI)
            body: '(message text not stored)',
            status: decision.send === false ? 'skipped' : 'sending',
            reason: decision.send === false ? decision.reason : null,
            sentAt: now,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        result.errors.push(err instanceof Error ? err.name : 'log write failed');
        continue;
      }
      if (decision.send === false) {
        result[channel].skipped++;
        continue;
      }

      let status: 'sent' | 'failed' = 'failed';
      let reason: string | null = null;
      try {
        if (channel === 'sms') {
          const r = await deps.sendSms({ to: appt.client.phone, body: smsText!, context: `appointment-reminder-${window}` });
          // Only a hand-off to AWS counts as sent (dev console output is not a delivered text)
          status = r.mode === 'sms' || r.mode === 'sns' ? 'sent' : 'failed';
          if (r.mode === 'skipped') reason = 'invalid_phone';
          else if (r.mode === 'console') reason = 'sms_not_configured';
        } else {
          await deps.sendEmail({
            to: appt.client.email,
            subject: email!.subject,
            text: email!.text,
            html: email!.html,
            headers: email!.headers,
            context: `appointment-reminder-${window}`,
          });
          status = 'sent';
        }
      } catch (err) {
        reason = 'send_error';
        result.errors.push(`${channel}: ${err instanceof Error ? err.name : 'send failed'}`);
      }
      result[channel][status]++;
      await db.notificationLog
        .update({
          where: { dedupeKey },
          data: { status, reason, successCount: status === 'sent' ? 1 : 0, failureCount: status === 'failed' ? 1 : 0 },
        })
        .catch(() => {});
    }
  }
  return result;
}
