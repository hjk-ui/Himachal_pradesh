import { awsClientConfig } from '@/lib/aws/clientConfig';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { normalizeToE164 } from '@/lib/sms/phone';
import { isSnsSmsConfigured } from '@/lib/sms/send';
import { sendPatientSms, type PatientSmsReason } from '@/lib/sms/patientSms';
import { hasAwsRoleOrKeys } from '@/lib/aws/credentials';

/** Connect / SMS is not set up on this server: routes answer 503, never a simulated success. */
export class ConnectNotConfiguredError extends Error {
  readonly status = 503;
  constructor(message = 'Amazon Connect not configured — use your phone') {
    super(message);
    this.name = 'ConnectNotConfiguredError';
  }
}

/** Amazon Connect US DID path — destination should be +1 + 10 digits. */
export function isUsE164(phone: string | null | undefined): phone is string {
  return Boolean(phone && /^\+1\d{10}$/.test(phone));
}

/** Static keys or AWS_LIVE=true (instance role), plus the Connect instance configuration */
export function isConnectLive(): boolean {
  return Boolean(
    hasAwsRoleOrKeys() &&
      process.env.CONNECT_INSTANCE_ID?.trim() &&
      process.env.CONNECT_CONTACT_FLOW_ID?.trim() &&
      process.env.CONNECT_QUEUE_ID?.trim() &&
      process.env.CONNECT_SOURCE_PHONE_NUMBER?.trim()
  );
}

export function isAwsCredentialsPresent(): boolean {
  return hasAwsRoleOrKeys();
}

export function connectSourceLast4(): string | null {
  const src = process.env.CONNECT_SOURCE_PHONE_NUMBER?.trim() || '';
  const digits = src.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export function getConnectStatus() {
  const live = isConnectLive();
  return {
    live,
    demoMode: !live,
    sourceLast4: connectSourceLast4(),
    hasQueue: Boolean(process.env.CONNECT_QUEUE_ID?.trim()),
    region: process.env.AWS_REGION?.trim() || 'us-east-1',
  };
}

export async function placeOutboundCall(input: {
  organizationId: string;
  clientId: string;
  clientPhone: string;
  clinicianId?: string | null;
  clinicianPhone?: string | null;
  createdById?: string | null;
}) {
  const clientPhone = normalizeToE164(input.clientPhone);
  if (!clientPhone) {
    throw new Error('Client phone must be a valid E.164 number (+1XXXXXXXXXX)');
  }
  const clinicianPhone = input.clinicianPhone ? normalizeToE164(input.clinicianPhone) : null;
  if (!isConnectLive()) throw new ConnectNotConfiguredError();
  if (!isUsE164(clientPhone)) {
    throw new Error('Amazon Connect requires a US E.164 client phone (+1XXXXXXXXXX)');
  }
  const demoMode = false;
  let contactId: string | null = null;
  const status = 'INITIATED';
  const quotaNotice: string | null = null;

  try {
    const { ConnectClient, StartOutboundVoiceContactCommand } = await import('@aws-sdk/client-connect');
    const region =
      process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
    const client = new ConnectClient({
      ...awsClientConfig(),
      region,
      // No static keys: the SDK default chain uses the instance role (AWS_LIVE=true)
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
            }
          : undefined,
    });
    const result = await client.send(
      new StartOutboundVoiceContactCommand({
        InstanceId: process.env.CONNECT_INSTANCE_ID!.trim(),
        ContactFlowId: process.env.CONNECT_CONTACT_FLOW_ID!.trim(),
        DestinationPhoneNumber: clientPhone,
        SourcePhoneNumber: process.env.CONNECT_SOURCE_PHONE_NUMBER?.trim() || undefined,
        QueueId: process.env.CONNECT_QUEUE_ID?.trim() || undefined,
        Attributes: {
          clientId: input.clientId,
          organizationId: input.organizationId,
          clinicianId: input.clinicianId ?? input.createdById ?? '',
          clinicianPhone: clinicianPhone ?? '',
        },
      })
    );
    contactId = result.ContactId ?? null;
  } catch (err: any) {
    console.error('[connect] outbound call failed', err?.name || err);
    if (
      err?.name === 'LimitExceededException' ||
      err?.$metadata?.httpStatusCode === 429 ||
      err?.message?.includes('LimitExceeded')
    ) {
      throw new Error('Amazon Connect outbound call limit reached — the call was not placed. Use your phone.');
    }
    if (
      err?.name === 'DestinationNotAllowedException' ||
      err?.message?.includes('DestinationPhoneNumber is not valid')
    ) {
      throw new Error('Amazon Connect rejected the client phone number — the call was not placed.');
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Amazon Connect call could not be started: ${msg}`);
  }
  if (!contactId) throw new Error('Amazon Connect did not return a contact id — the call was not placed.');

  const row = await prisma.connectCall.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      clientPhone,
      clinicianPhone,
      contactId,
      status,
      demoMode,
      createdById: input.createdById ?? null,
    },
  });

  return { call: row, demoMode, contactId, quotaNotice };
}

export async function updateCallStatus(input: {
  organizationId: string;
  contactId?: string | null;
  callId?: string | null;
  status: string;
  durationSec?: number | null;
}) {
  const where = input.callId
    ? { id: input.callId }
    : input.contactId
      ? { organizationId: input.organizationId, contactId: input.contactId }
      : null;
  if (!where) return null;

  const existing = await prisma.connectCall.findFirst({ where });
  if (!existing) return null;

  const prevAnalysis =
    existing.analysisJson && typeof existing.analysisJson === 'object'
      ? (existing.analysisJson as Record<string, unknown>)
      : {};

  return prisma.connectCall.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      analysisJson: {
        ...prevAnalysis,
        ...(input.durationSec != null ? { durationSec: input.durationSec } : {}),
        endedAt: new Date().toISOString(),
      },
    },
  });
}

/** The consent gate refused or the SMS service failed: nothing was sent (no fake success). */
export class SmsNotSentError extends Error {
  constructor(
    readonly reason: PatientSmsReason,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SmsNotSentError';
  }
}

/**
 * Staff-typed text to a patient. Consent-gated like every patient text (src/lib/sms/patientSms.ts):
 * consent, no STOP / revoked consent, only the charted number, no clinical / billing terms; opt-out
 * wording is appended when the staff member left it out.
 */
export async function sendConnectSms(input: {
  organizationId: string;
  clientId: string;
  toPhone: string;
  body: string;
  createdById?: string | null;
  actorRole?: string | null;
}) {
  const phone = normalizeToE164(input.toPhone);
  if (!phone) throw new Error('Destination phone must be a valid E.164 number');
  const typed = input.body.trim();
  if (!typed) throw new Error('Message body is required');
  if (typed.length > 1600) throw new Error('SMS body must be 1600 characters or fewer');

  if (!isSnsSmsConfigured()) throw new ConnectNotConfiguredError('SMS not configured on this server — nothing was sent');
  const demoMode = false;
  const text = await sendPatientSms({
    clientId: input.clientId,
    organizationId: input.organizationId,
    purpose: 'staff_message',
    to: phone,
    actor: { userId: input.createdById ?? null, role: input.actorRole ?? null },
    build: () => typed,
  });
  if (!text.sent) {
    const reason = 'reason' in text ? text.reason : 'send_error';
    const status = reason === 'sms_not_configured' ? 503 : reason === 'send_error' ? 502 : 422;
    throw new SmsNotSentError(reason, text.message, status);
  }
  const status = 'sent';

  const row = await prisma.connectMessage.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      direction: 'outbound',
      body: text.body,
      status,
      demoMode,
      createdById: input.createdById ?? null,
    },
  });

  return { message: row, demoMode };
}

export async function listThread(organizationId: string, clientId: string) {
  return prisma.connectMessage.findMany({
    where: { organizationId, clientId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listCalls(organizationId: string, clientId: string) {
  const calls = await prisma.connectCall.findMany({
    where: { organizationId, clientId },
    orderBy: { createdAt: 'desc' },
  });

  const userIds = Array.from(new Set(calls.map((c) => c.createdById).filter(Boolean))) as string[];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return calls.map((c) => {
    const analysisObj =
      c.analysisJson && typeof c.analysisJson === 'object'
        ? (c.analysisJson as Record<string, unknown>)
        : null;
    const durationSec =
      typeof analysisObj?.durationSec === 'number' ? analysisObj.durationSec : null;
    return {
      ...c,
      clinicianName: c.createdById ? userMap.get(c.createdById) || null : null,
      durationSec,
    };
  });
}

/** `client` narrows to clients the caller may see (clientAccessWhere); routes always pass it. */
export async function getCallAnalysis(organizationId: string, contactId: string, client?: Prisma.ClientWhereInput) {
  const call = await prisma.connectCall.findFirst({
    where: { organizationId, contactId, ...(client ? { client } : {}) },
  });
  if (!call) return null;

  // Contact Lens: merge live JSON when present with defaults for clean UI rendering
  const prev =
    call.analysisJson && typeof call.analysisJson === 'object'
      ? (call.analysisJson as Record<string, unknown>)
      : {};

  // Only what Contact Lens actually returned: no default sentiment, summary or phrases
  const analysis = {
    sentiment: (prev.sentiment as string) || null,
    summary: (prev.summary as string) || null,
    keyPhrases: (prev.keyPhrases as string[]) || [],
    crisisKeywords: (prev.crisisKeywords as string[]) || [],
    demoMode: prev.demoMode ?? call.demoMode,
    ...prev,
  };

  return { ...call, analysis };
}

export async function upsertContactNote(input: {
  organizationId: string;
  clientId: string;
  note: string;
  createdById?: string | null;
}) {
  // Persist contact attempt as an outbound system message for audit trail
  return prisma.connectMessage.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      direction: 'system',
      body: input.note.trim() || 'Contact logged',
      status: 'logged',
      demoMode: false,
      createdById: input.createdById ?? null,
    },
  });
}
