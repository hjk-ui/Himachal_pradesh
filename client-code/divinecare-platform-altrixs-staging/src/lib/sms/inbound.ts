import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { normalizeToE164 } from '@/lib/sms/phone';
import { normalizePhoneDigits } from '@/lib/scheduling/identity';
import {
  confirmReplyText,
  helpReplyText,
  parseSmsKeyword,
  stopReplyText,
  unstopReplyText,
  type SmsKeyword,
} from '@/lib/sms/keywords';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendSms } from '@/lib/sms/send';
import { applyMarketingInbound, sendAutoReply } from '@/lib/marketing/inboundHook';

/**
 * Inbound text handling (AWS End User Messaging two-way SMS -> SNS -> /api/sms/inbound).
 *
 *   STOP (and synonyms)  -> smsOptOutAt = now on EVERY client with that number (opt-out is per number)
 *   START / UNSTOP       -> smsOptOutAt cleared; consent recorded with source sms_unstop
 *   HELP                 -> HELP reply (only when we manage keywords ourselves, see below)
 *   C / CONFIRM          -> confirmedAt on the upcoming appointment we sent an SMS reminder for
 *   anything else        -> recorded only (no auto-reply; message text is not stored)
 *
 * End User Messaging answers STOP / HELP itself with the keyword responses configured on the
 * phone number, and keeps its own opt-out list. Set SMS_SELF_MANAGED_KEYWORDS=true only when
 * self-managed opt-outs are turned on for the number; then this handler sends the replies.
 */

export const CONFIRM_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/** Injectable for tests; production uses prisma / sendSms / writeAuditLog. */
export type InboundDeps = { db: any; send: typeof sendSms; audit: typeof writeAuditLog };
const defaultDeps = (): InboundDeps => ({ db: prisma, send: sendSms, audit: writeAuditLog });

type ClientHit = { id: string; organizationId: string | null; phone: string | null; smsConsent: boolean; smsOptOutAt: Date | null };

async function clientsForNumber(db: InboundDeps['db'], e164: string): Promise<ClientHit[]> {
  const digits = normalizePhoneDigits(e164);
  if (digits.length < 7) return [];
  const rows: ClientHit[] = await db.client.findMany({
    where: { phone: { contains: digits.slice(-4) } },
    select: { id: true, organizationId: true, phone: true, smsConsent: true, smsOptOutAt: true },
    take: 500,
  });
  return rows.filter((r) => normalizePhoneDigits(r.phone) === digits);
}

async function programName(db: InboundDeps['db'], organizationId: string | null | undefined): Promise<{ name: string; phone: string | null }> {
  const fallback = process.env.SMS_PROGRAM_NAME?.trim() || 'Altrixs';
  if (!organizationId) return { name: fallback, phone: null };
  const [sched, org] = await Promise.all([
    db.schedulingSettings.findUnique({ where: { organizationId }, select: { practiceName: true, contactPhone: true } }).catch(() => null),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).catch(() => null),
  ]);
  return { name: sched?.practiceName?.trim() || org?.name?.trim() || fallback, phone: sched?.contactPhone ?? null };
}

/** Most recent upcoming appointment (of these clients) that we texted a reminder for. */
async function appointmentToConfirm(db: InboundDeps['db'], clientIds: string[], now: Date): Promise<string | null> {
  if (!clientIds.length) return null;
  const logs: { appointmentId: string | null }[] = await db.notificationLog.findMany({
    where: {
      clientId: { in: clientIds },
      type: 'appointment_reminder',
      channel: 'sms',
      status: 'sent',
      appointmentId: { not: null },
      sentAt: { gte: new Date(now.getTime() - CONFIRM_LOOKBACK_MS) },
    },
    orderBy: { sentAt: 'desc' },
    select: { appointmentId: true },
    take: 10,
  });
  const ids = Array.from(new Set(logs.map((l) => l.appointmentId).filter((x): x is string => Boolean(x))));
  if (!ids.length) return null;
  const appt: { id: string } | null = await db.appointment.findFirst({
    where: { id: { in: ids }, status: 'SCHEDULED', startsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
    select: { id: true },
  });
  return appt?.id ?? null;
}

export type InboundResult = {
  duplicate: boolean;
  keyword: SmsKeyword;
  clientCount: number;
  appointmentId: string | null;
  replied: boolean;
};

export async function handleInboundSms(input: {
  snsMessageId: string;
  fromNumber: string;
  body: string;
  now?: Date;
}, deps: InboundDeps = defaultDeps()): Promise<InboundResult> {
  const { db } = deps;
  const now = input.now ?? new Date();
  const from = normalizeToE164(input.fromNumber) || input.fromNumber.trim();
  const keyword = parseSmsKeyword(input.body);
  const clients = await clientsForNumber(db, from);
  const clientIds = clients.map((c) => c.id);

  // Dedupe SNS retries before acting.
  try {
    await db.smsInboundEvent.create({
      data: { snsMessageId: input.snsMessageId, fromNumber: from, keyword, clientIds, receivedAt: now },
    });
  } catch (err) {
    if ((err instanceof Prisma.PrismaClientKnownRequestError || (err as { code?: string })?.code) && (err as { code?: string }).code === 'P2002') {
      return { duplicate: true, keyword, clientCount: clientIds.length, appointmentId: null, replied: false };
    }
    throw err;
  }

  let appointmentId: string | null = null;
  if (keyword === 'stop' && clientIds.length) {
    await db.client.updateMany({ where: { id: { in: clientIds }, smsOptOutAt: null }, data: { smsOptOutAt: now } });
  } else if (keyword === 'unstop' && clientIds.length) {
    await db.client.updateMany({
      where: { id: { in: clientIds } },
      data: { smsOptOutAt: null, smsConsent: true, smsConsentAt: now, smsConsentSource: 'sms_unstop' },
    });
  } else if (keyword === 'confirm' && clientIds.length) {
    appointmentId = await appointmentToConfirm(db, clientIds, now);
    if (appointmentId) {
      await db.appointment.updateMany({ where: { id: appointmentId, confirmedAt: null }, data: { confirmedAt: now } });
      await db.smsInboundEvent.update({ where: { snsMessageId: input.snsMessageId }, data: { appointmentId } });
    }
  }

  // Marketing leads / contacts with this number (STOP is per number; lead replies join the lead inbox)
  const marketing = await applyMarketingInbound(db, { from, keyword, body: input.body, now });

  for (const c of clients) {
    await deps.audit({
      action: `SMS_INBOUND_${keyword.toUpperCase()}`,
      actorUserId: null,
      actorRole: 'PATIENT',
      organizationId: c.organizationId,
      resourceType: keyword === 'confirm' && appointmentId ? 'appointment' : 'client',
      resourceId: keyword === 'confirm' && appointmentId ? appointmentId : c.id,
      patientId: c.id,
      metadata: { via: 'sms_inbound', keyword, snsMessageId: input.snsMessageId },
    });
  }

  // KEYWORD REPLIES (classified exception to the patient consent gate, src/lib/sms/patientSms.ts):
  // answers to a text the number just sent us. CTIA requires the one STOP confirmation even though
  // the number has opted out, so these do not go through sendPatientSms. Fixed templates, never PHI;
  // STOP / HELP / START only when we manage keywords ourselves.
  const selfManaged = process.env.SMS_SELF_MANAGED_KEYWORDS === 'true';
  let reply: string | null = null;
  const program = await programName(db, clients[0]?.organizationId);
  if (selfManaged && keyword === 'stop') reply = stopReplyText(program.name);
  else if (selfManaged && keyword === 'unstop') reply = unstopReplyText(program.name);
  else if (selfManaged && keyword === 'help') reply = helpReplyText({ practiceName: program.name, contactPhone: program.phone });
  else if (keyword === 'confirm' && appointmentId) reply = confirmReplyText(program.name);

  let replied = false;
  if (reply) {
    try {
      const r = await deps.send({ to: from, body: reply, context: `inbound-${keyword}` });
      replied = r.mode === 'sms' || r.mode === 'sns';
    } catch (err) {
      console.error('[sms:inbound] reply failed', err instanceof Error ? err.name : 'error');
    }
  }
  if (marketing.autoReplyLeadId) await sendAutoReply(marketing.autoReplyLeadId).catch(() => {});
  return { duplicate: false, keyword, clientCount: clientIds.length, appointmentId, replied };
}
