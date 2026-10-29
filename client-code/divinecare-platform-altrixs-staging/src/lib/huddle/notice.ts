/**
 * Huddle sheet evening notice, called by scripts/chart-digest-prep.ts after an organization's
 * evening (--dates=tomorrow) prep finishes. Behind HUDDLE_EMAIL_NOTICE=on (default off).
 *
 * One email per provider with visits tomorrow: "Your summary for tomorrow (N visits) is ready" and a
 * link to the huddle page. NO PHI: no client names, MRNs, diagnoses, visit types or flags; the
 * subject and body come from huddleNoticeEmail (counts + date only). Providers who turned the
 * email off (User.huddleEmailOptOutAt) are skipped. Delivery is logged by sendEmail in the
 * integration log (template "huddle_notice", outcome only); the run itself writes one audit row
 * with counts only.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/email/smtp';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { getAppBaseUrl } from '@/lib/app/baseUrl';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { HUDDLE_EXCLUDED_STATUSES, canViewHuddle, huddleNoticeEmail, huddleNoticeEnabled, visitsByProvider } from './core';

export const HUDDLE_NOTICE_TEMPLATE = 'huddle_notice';

export type HuddleNoticeResult = {
  enabled: boolean;
  providers: number;
  sent: number;
  optedOut: number;
  noEmail: number;
  failed: number;
};

export async function sendHuddleNotices(input: { organizationId: string; date: string; label?: string }, env: Record<string, string | undefined> = process.env): Promise<HuddleNoticeResult> {
  const result: HuddleNoticeResult = { enabled: huddleNoticeEnabled(env), providers: 0, sent: 0, optedOut: 0, noEmail: 0, failed: 0 };
  if (!result.enabled) return result;
  const org = input.organizationId;
  const timeZone = await getPracticeTimeZone(org);
  const { start, end } = practiceDayBounds(input.date, timeZone);
  const appts = await prisma.appointment.findMany({
    where: { client: { organizationId: org }, clinicianId: { not: null }, startsAt: { gte: start, lt: end }, status: { notIn: [...HUDDLE_EXCLUDED_STATUSES] } },
    select: { clinicianId: true, status: true },
    take: 10_000,
  });
  const counts = visitsByProvider(appts.map((a) => ({ clinicianId: a.clinicianId, status: String(a.status) })));
  if (!counts.size) return result;
  const users = await prisma.user.findMany({
    where: { id: { in: [...counts.keys()] }, organizationId: org, status: 'ACTIVE' },
    select: { id: true, email: true, role: true, roles: true, huddleEmailOptOutAt: true },
  });
  const baseUrl = getAppBaseUrl();
  for (const u of users) {
    // Only staff who can open the huddle page get the notice
    if (!canViewHuddle(String(u.role)) && !(u.roles ?? []).some((r: Role) => canViewHuddle(String(r)))) continue;
    result.providers++;
    if (u.huddleEmailOptOutAt) {
      result.optedOut++;
      continue;
    }
    if (!u.email?.trim()) {
      result.noEmail++;
      continue;
    }
    const mail = huddleNoticeEmail({ visits: counts.get(u.id) ?? 0, date: input.date, baseUrl });
    try {
      await sendEmail({ to: u.email, subject: mail.subject, text: mail.text, html: mail.html, context: HUDDLE_NOTICE_TEMPLATE, organizationId: org, clientId: null });
      result.sent++;
    } catch {
      result.failed++;
    }
  }
  await writeAuditLog({
    action: 'huddle_notice_run',
    actorUserId: null,
    actorRole: 'system',
    organizationId: org,
    resourceType: 'huddleSheet',
    outcome: result.failed && !result.sent ? 'FAILURE' : 'SUCCESS',
    userAgent: input.label ?? 'huddle-notice',
    metadata: { date: input.date, ...result },
  }).catch(() => {});
  return result;
}
