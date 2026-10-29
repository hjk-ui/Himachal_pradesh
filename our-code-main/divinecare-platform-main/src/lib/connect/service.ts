import { prisma } from '@/lib/db/prisma';
import { normalizeToE164 } from '@/lib/sms/phone';
import { sendSms } from '@/lib/sms/send';

/** Amazon Connect US DID path — destination should be +1 + 10 digits. */
export function isUsE164(phone: string | null | undefined): phone is string {
  return Boolean(phone && /^\+1\d{10}$/.test(phone));
}

export function isConnectLive(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID?.trim() &&
      process.env.AWS_SECRET_ACCESS_KEY?.trim() &&
      process.env.CONNECT_INSTANCE_ID?.trim() &&
      process.env.CONNECT_CONTACT_FLOW_ID?.trim() &&
      process.env.CONNECT_QUEUE_ID?.trim() &&
      process.env.CONNECT_SOURCE_PHONE_NUMBER?.trim()
  );
}

export function isAwsCredentialsPresent(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim());
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
  let demoMode = !isConnectLive();
  let contactId: string | null = null;
  let status = 'INITIATED';
  let quotaNotice: string | null = null;

  if (!demoMode) {
    if (!isUsE164(clientPhone)) {
      throw new Error('Amazon Connect requires a US E.164 client phone (+1XXXXXXXXXX)');
    }
    try {
      const { ConnectClient, StartOutboundVoiceContactCommand } = await import(
        '@aws-sdk/client-connect'
      );
      const region =
        process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
      const client = new ConnectClient({
        region,
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
      status = 'INITIATED';
    } catch (err: any) {
      console.error('[connect] outbound call failed', err);
      if (
        err?.name === 'LimitExceededException' ||
        err?.$metadata?.httpStatusCode === 429 ||
        err?.message?.includes('LimitExceeded') ||
        err?.message?.includes('UnknownError')
      ) {
        demoMode = true;
        contactId = `demo-quota-${Date.now()}`;
        status = 'INITIATED';
        quotaNotice = 'AWS Connect outbound call quota limit reached on your AWS account. Simulated in Demo Mode.';
      } else if (
        err?.name === 'DestinationNotAllowedException' ||
        err?.message?.includes('DestinationPhoneNumber is not valid')
      ) {
        demoMode = true;
        contactId = `demo-invalid-${Date.now()}`;
        status = 'INITIATED';
        quotaNotice = 'Client phone number has an invalid US area code. Simulated in Demo Mode.';
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Amazon Connect call could not be started: ${msg}`);
      }
    }
  } else {
    contactId = `demo-call-${Date.now()}`;
    status = 'INITIATED';
  }

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

export async function sendConnectSms(input: {
  organizationId: string;
  clientId: string;
  toPhone: string;
  body: string;
  createdById?: string | null;
}) {
  const phone = normalizeToE164(input.toPhone);
  if (!phone) throw new Error('Destination phone must be a valid E.164 number');
  const body = input.body.trim();
  if (!body) throw new Error('Message body is required');
  if (body.length > 1600) throw new Error('SMS body must be 1600 characters or fewer');

  const demoMode = !isAwsCredentialsPresent();
  let status = 'sent';

  if (!demoMode) {
    try {
      const result = await sendSms({ to: phone, body, context: 'connect-sms' });
      status = result.mode === 'sns' ? 'sent' : result.mode;
    } catch (err) {
      console.error('[connect] SMS failed', err);
      throw new Error('SMS could not be sent');
    }
  } else {
    status = 'demo_sent';
  }

  const row = await prisma.connectMessage.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      direction: 'outbound',
      body,
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

export async function getCallAnalysis(organizationId: string, contactId: string) {
  const call = await prisma.connectCall.findFirst({
    where: { organizationId, contactId },
  });
  if (!call) return null;

  // Contact Lens: merge live JSON when present with defaults for clean UI rendering
  const prev =
    call.analysisJson && typeof call.analysisJson === 'object'
      ? (call.analysisJson as Record<string, unknown>)
      : {};

  const analysis = {
    sentiment: (prev.sentiment as string) || 'NEUTRAL',
    summary:
      (prev.summary as string) ||
      'Demo Contact Lens summary — Configure Amazon Connect Contact Lens to receive live sentiment, transcript highlights, and crisis keywords.',
    keyPhrases: (prev.keyPhrases as string[]) || ['follow-up', 'medication', 'appointment'],
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
      demoMode: !isAwsCredentialsPresent(),
      createdById: input.createdById ?? null,
    },
  });
}
