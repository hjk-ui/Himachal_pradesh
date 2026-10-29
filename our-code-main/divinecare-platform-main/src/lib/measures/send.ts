import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { sendEmail } from '@/lib/mail/sendEmail';
import { sendSms } from '@/lib/sms/send';
import { patientSmsAllowed } from '@/lib/sms/patient-gate';
import { getAppBaseUrl } from '@/lib/staff/invite';
import { generateMeasureToken, hashMeasureToken } from './hash';
import { itemContentPendingFor, isKnownSelfReportInstrument } from './instruments';
import { measureEmailSubject, NOT_SENT_REASONS, type NotSentCode } from './copy';

export type MeasureChannel = 'email' | 'sms' | 'portal' | 'in_session';
export const MEASURE_CHANNELS: readonly MeasureChannel[] = ['email', 'sms', 'portal', 'in_session'];

/** How long a patient link stays valid. */
export const MEASURE_LINK_TTL_DAYS = 7;

export type SendEligibilityInput = {
  channel: MeasureChannel;
  instrumentKnown: boolean;
  itemContentPending: boolean;
  assignmentStatus?: string | null;
  hasDob: boolean;
  email: string | null;
  phone: string | null;
  smsAllowed: { allowed: boolean; reason?: 'no_consent' | 'opted_out' | 'not_found' } | null;
};

/** Pure pre-send checks. Returns the first reason the questionnaire cannot go out, or null. */
export function checkSendEligibility(input: SendEligibilityInput): NotSentCode | null {
  if (!input.instrumentKnown) return 'unknown_instrument';
  if (input.itemContentPending) return 'item_content_pending';
  if (input.assignmentStatus && input.assignmentStatus !== 'active') return 'assignment_inactive';
  if (!input.hasDob) return 'no_dob';
  switch (input.channel) {
    case 'email':
      return input.email?.trim() ? null : 'no_email';
    case 'sms':
      if (!input.phone?.trim()) return 'no_phone';
      if (input.smsAllowed && !input.smsAllowed.allowed) {
        return input.smsAllowed.reason === 'opted_out' ? 'sms_opted_out' : 'sms_no_consent';
      }
      return null;
    case 'portal':
      return 'portal_unavailable';
    case 'in_session':
      return null;
  }
}

export type SendMeasureInput = {
  organizationId: string;
  clientId: string;
  instrumentKey: string;
  channel: MeasureChannel;
  assignmentId?: string | null;
  now?: Date;
};

export type SendMeasureResult =
  | {
      ok: true;
      requestId: string;
      channel: MeasureChannel;
      expiresAt: string;
      /** Only for in_session: shown once to staff to hand the device over. Never stored. */
      link?: string;
    }
  | { ok: false; reason: NotSentCode; message: string };

function notSent(reason: NotSentCode): SendMeasureResult {
  return { ok: false, reason, message: NOT_SENT_REASONS[reason] };
}

export function buildMeasureLink(token: string): string {
  return `${getAppBaseUrl()}/m/${token}`;
}

/**
 * Creates a MeasureRequest (sha256 token hash only) and delivers the link.
 * Callers must have already authorized the staff user for this client (clientAccessWhere,
 * sensitive-record gate); this function re-checks tenant scope only.
 */
export async function sendMeasure(input: SendMeasureInput): Promise<SendMeasureResult> {
  const now = input.now ?? new Date();
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, AND: [clientOrgFilter(input.organizationId)] },
    select: { id: true, email: true, phone: true, dateOfBirth: true, organization: { select: { name: true } } },
  });
  if (!client) return notSent('not_found');

  const assignment = input.assignmentId
    ? await prisma.measureAssignment.findFirst({
        where: {
          id: input.assignmentId,
          organizationId: input.organizationId,
          clientId: input.clientId,
          instrumentKey: input.instrumentKey,
        },
        select: { id: true, status: true },
      })
    : null;
  if (input.assignmentId && !assignment) return notSent('assignment_inactive');

  const smsAllowed = input.channel === 'sms' ? await patientSmsAllowed(client.id) : null;
  const blocked = checkSendEligibility({
    channel: input.channel,
    instrumentKnown: isKnownSelfReportInstrument(input.instrumentKey),
    itemContentPending: itemContentPendingFor(input.instrumentKey),
    assignmentStatus: assignment?.status,
    hasDob: Boolean(client.dateOfBirth),
    email: client.email,
    phone: client.phone,
    smsAllowed,
  });
  if (blocked) return notSent(blocked);

  const token = generateMeasureToken();
  const expiresAt = new Date(now.getTime() + MEASURE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
  const request = await prisma.measureRequest.create({
    data: {
      organizationId: input.organizationId,
      clientId: client.id,
      assignmentId: assignment?.id ?? null,
      instrumentKey: input.instrumentKey,
      channel: input.channel,
      tokenHash: hashMeasureToken(token),
      status: 'pending',
      expiresAt,
    },
    select: { id: true },
  });

  const link = buildMeasureLink(token);
  const practice = client.organization?.name?.trim() || 'Your care team';

  try {
    if (input.channel === 'email') {
      await sendEmail({
        to: client.email!.trim(),
        subject: measureEmailSubject(practice),
        text: [
          `${practice} sent you a short questionnaire to complete before your visit.`,
          '',
          `Open it here: ${link}`,
          '',
          'You will be asked to confirm your date of birth first.',
          `This link expires on ${expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`,
          'If you were not expecting this message, you can ignore it.',
        ].join('\n'),
        context: 'measures',
      });
    } else if (input.channel === 'sms') {
      const sent = await sendSms({
        to: client.phone!,
        clientId: client.id,
        body: `${practice}: a short questionnaire is ready before your visit: ${link}`,
        context: 'measures',
      });
      if (sent.mode === 'skipped') throw new Error('sms skipped');
    }
  } catch (err) {
    // Nothing reached the patient: remove the live link so it cannot be guessed or reused.
    await prisma.measureRequest.delete({ where: { id: request.id } }).catch(() => undefined);
    console.error('[measures send]', input.channel, err instanceof Error ? err.message : 'failed');
    return notSent('delivery_failed');
  }

  return {
    ok: true,
    requestId: request.id,
    channel: input.channel,
    expiresAt: expiresAt.toISOString(),
    ...(input.channel === 'in_session' ? { link } : {}),
  };
}
