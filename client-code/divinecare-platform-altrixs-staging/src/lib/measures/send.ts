/**
 * Sending a measure link to a patient (server). Used by the pre-visit job (scripts/measures-send.ts)
 * and by staff "Send now" (chart Measures card / outcomes page).
 *
 *  - One request = one link (/m/<token>) for one or more measures; the token is stored as sha256.
 *  - Channels from planDelivery (delivery.ts): email when on file and not opted out; SMS only
 *    through the patient SMS gate (consent / STOP / charted number; SMS unavailable until
 *    toll-free registration -> "not sent: SMS not available", the email still counts).
 *  - Messages carry no PHI (messages.ts; measureRequestSms).
 *  - Automatic sends carry dedupeKey "<appointmentId>:<stage>": never two sends for one visit and stage.
 *  - Every send / not-sent is audit-logged with ids and channel results only.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendEmail } from '@/lib/email/smtp';
import { sendPatientSms } from '@/lib/sms/patientSms';
import { measureRequestSms } from '@/lib/sms/templates';
import { loadPracticeIdentity } from '@/lib/practice/identity';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { hashMeasureToken, linkExpiry, newMeasureToken } from './token';
import { measureLinkUrl, measureRequestEmail } from './messages';
import { NOT_SENT_TEXT, part2ConsentCoversPatient, planDelivery, type DeliveryChannel, type NotSentReason } from './delivery';

export type SendActor = { userId: string | null; role: string | null };

export type ChannelResult = { channel: DeliveryChannel; ok: boolean; message: string };

export type SendResult =
  | { ok: true; requestId: string; status: 'sent' | 'not_sent'; results: ChannelResult[]; message: string; droppedPart2: string[]; droppedNotSendable: string[] }
  | { ok: false; status: 'not_sent' | 'duplicate' | 'not_found'; reason: NotSentReason | 'duplicate' | 'client_not_found'; message: string; requestId?: string; droppedPart2?: string[]; droppedNotSendable?: string[] };

/** Part 2 client: SensitiveRecord classified Part 2 / SUD, or any Part 2 progress note */
export async function isPart2ClientFor(organizationId: string, clientId: string): Promise<boolean> {
  const [rec, note] = await Promise.all([
    prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { noteClassification: true } }),
    prisma.progressNote.findFirst({ where: { clientId, part2: true, client: { organizationId } }, select: { id: true } }),
  ]);
  return isPart2Classification(rec?.noteClassification) || Boolean(note);
}

export async function part2ConsentCovers(organizationId: string, clientId: string, now = new Date()): Promise<boolean> {
  const rows = await prisma.consentForm.findMany({
    where: { organizationId, clientId, status: 'SIGNED', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { type: true, formKey: true, recipientName: true },
    take: 100,
  });
  return part2ConsentCoversPatient(rows);
}

const SMS_NOT_AVAILABLE = /not configured|service returned an error|not a valid mobile/i;

export async function sendMeasureRequest(input: {
  organizationId: string;
  clientId: string;
  instrumentIds: string[];
  assignmentIds?: string[];
  trigger: 'manual' | 'visit_3d' | 'visit_1d';
  appointmentId?: string | null;
  clinicianId?: string | null;
  channels?: DeliveryChannel[];
  actor: SendActor;
  now?: Date;
}): Promise<SendResult> {
  const now = input.now ?? new Date();
  const org = input.organizationId;
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, organizationId: org },
    select: { id: true, dateOfBirth: true, email: true, emailOptOutAt: true, phone: true, smsConsent: true, smsOptOutAt: true, status: true, deceasedAt: true, assignedToId: true },
  });
  if (!client) return { ok: false, status: 'not_found', reason: 'client_not_found', message: 'Client not found.' };
  const part2Client = await isPart2ClientFor(org, client.id);
  // Portal only when staff chose it: the client's own ACTIVE login (proxies never see measures)
  const portalActive = input.channels?.includes('portal')
    ? Boolean(await prisma.patientAccount.findFirst({ where: { clientId: client.id, status: 'ACTIVE' }, select: { id: true } }))
    : false;
  const plan = planDelivery({
    client: { ...client, portalActive },
    instrumentIds: input.instrumentIds,
    allowed: input.channels,
    part2Client,
    part2ConsentCovers: part2Client ? await part2ConsentCovers(org, client.id, now) : false,
  });
  const dedupeKey = input.appointmentId && input.trigger !== 'manual' ? `${input.appointmentId}:${input.trigger}` : null;
  const audit = (action: string, outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', resourceId: string | null, metadata: Record<string, unknown>) =>
    writeAuditLog({ action, actorUserId: input.actor.userId, actorRole: input.actor.role ?? 'SYSTEM', organizationId: org, resourceType: 'measureRequest', resourceId, patientId: client.id, outcome, metadata }).catch(() => {});

  if (plan.ok === false) {
    // Automatic sends record the skip once per visit and stage so staff see "Not sent" and why
    let requestId: string | undefined;
    if (dedupeKey && plan.reason !== 'no_measures') {
      try {
        const row = await prisma.measureRequest.create({
          data: {
            organizationId: org, clientId: client.id, instrumentIds: [...new Set(input.instrumentIds)], assignmentIds: input.assignmentIds ?? [],
            tokenHash: hashMeasureToken(newMeasureToken()), channel: 'email', status: 'not_sent', notSentReason: plan.reason, trigger: input.trigger,
            dedupeKey, appointmentId: input.appointmentId ?? null, clinicianId: input.clinicianId ?? client.assignedToId, sentById: input.actor.userId, expiresAt: linkExpiry(now),
          },
          select: { id: true },
        });
        requestId = row.id;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        return { ok: false, status: 'duplicate', reason: 'duplicate', message: 'Already handled for this visit.' };
      }
    }
    await audit('MEASURE_REQUEST_NOT_SENT', plan.reason === 'part2_in_session_only' ? 'DENIED' : 'FAILURE', requestId ?? null, {
      reason: plan.reason, trigger: input.trigger, appointmentId: input.appointmentId ?? null, measureCount: input.instrumentIds.length, droppedPart2: plan.droppedPart2.length,
    });
    return { ok: false, status: 'not_sent', reason: plan.reason, message: NOT_SENT_TEXT[plan.reason], requestId, droppedPart2: plan.droppedPart2, droppedNotSendable: plan.droppedNotSendable };
  }

  const raw = newMeasureToken();
  let requestId: string;
  try {
    const row = await prisma.measureRequest.create({
      data: {
        organizationId: org, clientId: client.id, instrumentIds: plan.instrumentIds, assignmentIds: input.assignmentIds ?? [],
        tokenHash: hashMeasureToken(raw), channel: plan.channels[0], status: 'pending', trigger: input.trigger, dedupeKey,
        appointmentId: input.appointmentId ?? null, clinicianId: input.clinicianId ?? client.assignedToId, sentById: input.actor.userId,
        expiresAt: linkExpiry(now), part2: plan.part2,
      },
      select: { id: true },
    });
    requestId = row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, status: 'duplicate', reason: 'duplicate', message: 'Already sent for this visit.' };
    }
    throw err;
  }

  const url = measureLinkUrl(raw);
  const results: ChannelResult[] = [];
  if (plan.channels.includes('email')) {
    try {
      const identity = await loadPracticeIdentity(org);
      const mail = measureRequestEmail(identity.name, url);
      // Production throws when email is not configured; the dev console fallback counts as sent (same as consent packets)
      await sendEmail({ to: client.email!, subject: mail.subject, text: mail.text, html: mail.html, context: 'measure-request' });
      results.push({ channel: 'email', ok: true, message: 'Email sent.' });
    } catch {
      results.push({ channel: 'email', ok: false, message: 'Email could not be sent.' });
    }
  }
  if (plan.channels.includes('sms')) {
    const r = await sendPatientSms({
      clientId: client.id, organizationId: org, purpose: 'measure_request', appointmentId: input.appointmentId ?? null,
      build: ({ sender }) => measureRequestSms({ sender, url }), actor: { userId: input.actor.userId, role: input.actor.role },
    });
    results.push({ channel: 'sms', ok: r.sent, message: r.sent ? 'Text sent.' : SMS_NOT_AVAILABLE.test(r.message) ? 'Not sent: SMS not available.' : r.message });
  }
  if (plan.channels.includes('portal')) {
    // Listed in the patient's portal (Questionnaires); no message is sent for this channel
    results.push({ channel: 'portal', ok: true, message: 'Posted to the patient portal.' });
  }
  const sent = results.filter((r) => r.ok);
  const status = sent.length ? 'sent' : 'not_sent';
  await prisma.measureRequest.update({
    where: { id: requestId },
    data: {
      status,
      channel: sent[0]?.channel ?? plan.channels[0],
      deliveryResults: results.map((r) => ({ channel: r.channel, ok: r.ok, reason: r.ok ? null : r.message })) as Prisma.InputJsonValue,
      notSentReason: sent.length ? null : 'all_channels_failed',
      sentAt: sent.length ? now : null,
    },
  });
  if (sent.length && input.assignmentIds?.length) {
    await prisma.measureAssignment.updateMany({ where: { organizationId: org, id: { in: input.assignmentIds } }, data: { lastSentAt: now } });
  }
  await audit(sent.length ? 'MEASURE_REQUEST_SENT' : 'MEASURE_REQUEST_NOT_SENT', sent.length ? 'SUCCESS' : 'FAILURE', requestId, {
    trigger: input.trigger,
    appointmentId: input.appointmentId ?? null,
    measureCount: plan.instrumentIds.length,
    assignmentIds: input.assignmentIds ?? [],
    channels: results.map((r) => `${r.channel}:${r.ok ? 'sent' : 'not_sent'}`),
    droppedPart2: plan.droppedPart2.length,
  });
  invalidateInboxForOrg(org);
  return {
    ok: true,
    requestId,
    status,
    results,
    message: sent.length ? `Sent by ${sent.map((r) => (r.channel === 'sms' ? 'text' : r.channel === 'portal' ? 'patient portal' : 'email')).join(' and ')}.` : NOT_SENT_TEXT.all_channels_failed,
    droppedPart2: plan.droppedPart2,
    droppedNotSendable: plan.droppedNotSendable,
  };
}
