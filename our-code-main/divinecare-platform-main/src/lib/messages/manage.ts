import type {
  MessageThreadStatus,
  MessageThreadTopic,
  RiskLevel,
  Role,
  ThreadMessageSender,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { formatRelativeTime, formatTimeOfDay } from '@/lib/date/relativeTime';
import { canAccessClientMessages, clientAccessWhere } from '@/lib/clients/orgScope';
import { isCaseloadRole } from '@/types/roles';
import { nameTokenMatches } from '@/lib/staff/nameMatch';
import { sendToUser } from '@/lib/notifications/pushService';
import { publishRealtimeMessage } from '@/lib/messages/realtime';

export type ThreadTopicUi =
  | 'scheduling'
  | 'billing'
  | 'general'
  | 'clinical'
  | 'rx-refill';
export type ThreadStatusUi = 'waiting' | 'in-progress' | 'forwarded' | 'resolved';
export type MessageRiskUi = 'high' | 'medium' | 'low';
export type SenderTypeUi = 'front-office' | 'patient' | 'clinician-note';

const TOPIC_UI: Record<MessageThreadTopic, ThreadTopicUi> = {
  SCHEDULING: 'scheduling',
  BILLING: 'billing',
  GENERAL: 'general',
  CLINICAL: 'clinical',
  RX_REFILL: 'rx-refill',
};
const TOPIC_DB: Record<string, MessageThreadTopic> = {
  scheduling: 'SCHEDULING',
  billing: 'BILLING',
  general: 'GENERAL',
  clinical: 'CLINICAL',
  'rx-refill': 'RX_REFILL',
};

const STATUS_UI: Record<MessageThreadStatus, ThreadStatusUi> = {
  WAITING: 'waiting',
  IN_PROGRESS: 'in-progress',
  FORWARDED: 'forwarded',
  RESOLVED: 'resolved',
};
const STATUS_DB: Record<string, MessageThreadStatus> = {
  waiting: 'WAITING',
  'in-progress': 'IN_PROGRESS',
  forwarded: 'FORWARDED',
  resolved: 'RESOLVED',
};

const RISK_UI: Record<RiskLevel, MessageRiskUi> = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

const SENDER_UI: Record<ThreadMessageSender, SenderTypeUi> = {
  FRONT_OFFICE: 'front-office',
  PATIENT: 'patient',
  CLINICIAN_NOTE: 'clinician-note',
};

export type ThreadDto = {
  id: string;
  clientId: string;
  clientName: string;
  topic: ThreadTopicUi;
  status: ThreadStatusUi;
  risk: MessageRiskUi;
  assignedStaff: string | null;
  forwardedTo: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  lastMessageTime: string;
  unreadCount: number;
};

export type ChatMessageDto = {
  id: string;
  threadId: string;
  senderType: SenderTypeUi;
  senderId: 'staff' | 'client' | 'clinician-note';
  senderName: string;
  content: string;
  read: boolean;
  createdAt: string;
  timestamp: string;
};

function serializeThread(row: {
  id: string;
  clientId: string;
  clientName: string;
  topic: MessageThreadTopic;
  status: MessageThreadStatus;
  risk: RiskLevel;
  assignedStaff: string | null;
  forwardedTo: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}): ThreadDto {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    topic: TOPIC_UI[row.topic],
    status: STATUS_UI[row.status],
    risk: RISK_UI[row.risk],
    assignedStaff: row.assignedStaff,
    forwardedTo: row.forwardedTo,
    lastMessage: row.lastMessage || '',
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessageTime: row.lastMessageAt
      ? formatRelativeTime(row.lastMessageAt)
      : '',
    unreadCount: row.unreadCount,
  };
}

function serializeMessage(row: {
  id: string;
  threadId: string;
  senderType: ThreadMessageSender;
  senderName: string;
  content: string;
  read: boolean;
  createdAt: Date;
}): ChatMessageDto {
  const senderType = SENDER_UI[row.senderType];
  return {
    id: row.id,
    threadId: row.threadId,
    senderType,
    senderId:
      senderType === 'patient'
        ? 'client'
        : senderType === 'clinician-note'
          ? 'clinician-note'
          : 'staff',
    senderName: row.senderName,
    content: row.content,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
    timestamp: formatTimeOfDay(row.createdAt),
  };
}

export async function listMessageThreads(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<ThreadDto[]> {
  if (!canAccessClientMessages(input.actorRole)) return [];

  let whereClause: any = {
    organizationId: input.organizationId,
    client: clientAccessWhere(input),
  };

  if (isCaseloadRole(input.actorRole)) {
    const actor = prisma.user
      ? await prisma.user
          .findUnique({
            where: { id: input.actorUserId },
            select: { name: true, email: true },
          })
          .catch(() => null)
      : null;
    const actorName = actor?.name?.trim();
    const actorEmail = actor?.email?.trim();

    whereClause = {
      organizationId: input.organizationId,
      OR: [
        { client: clientAccessWhere(input) },
        { forwardedTo: input.actorUserId },
        { assignedStaff: input.actorUserId },
        ...(actorName
          ? [
              { forwardedTo: { equals: actorName, mode: 'insensitive' as const } },
              { assignedStaff: { equals: actorName, mode: 'insensitive' as const } },
            ]
          : []),
        ...(actorEmail
          ? [{ forwardedTo: { equals: actorEmail, mode: 'insensitive' as const } }]
          : []),
      ],
    };
  }

  const rows = await prisma.messageThread.findMany({
    where: whereClause,
    orderBy: [{ unreadCount: 'desc' }, { lastMessageAt: 'desc' }],
    take: 200,
  });
  const office = input.actorRole === 'FRONT_DESK' || input.actorRole === 'OFFICE_MANAGER';
  let actorName: string | null = null;
  if (office) {
    const actor = await prisma.user
      .findUnique({ where: { id: input.actorUserId }, select: { name: true } })
      .catch(() => null);
    actorName = actor?.name?.trim() || null;
  }
  const visible = office
    ? rows.filter((row) => {
        if (row.topic === 'CLINICAL') return false;
        const topicOk = row.topic === 'SCHEDULING' || row.topic === 'BILLING' || row.topic === 'GENERAL';
        const assigned =
          row.assignedStaff === input.actorUserId ||
          row.forwardedTo === input.actorUserId ||
          nameTokenMatches(row.assignedStaff, actorName) ||
          nameTokenMatches(row.forwardedTo, actorName);
        return topicOk || assigned;
      })
    : rows;
  return visible.map(serializeThread);
}

export async function getThreadForActor(
  threadId: string,
  input: { organizationId: string; actorUserId: string; actorRole: Role }
) {
  if (isCaseloadRole(input.actorRole)) {
    const actor = prisma.user
      ? await prisma.user
          .findUnique({
            where: { id: input.actorUserId },
            select: { name: true, email: true },
          })
          .catch(() => null)
      : null;
    const actorName = actor?.name?.trim();
    const actorEmail = actor?.email?.trim();

    return prisma.messageThread.findFirst({
      where: {
        id: threadId,
        organizationId: input.organizationId,
        OR: [
          { client: clientAccessWhere(input) },
          { forwardedTo: input.actorUserId },
          { assignedStaff: input.actorUserId },
          ...(actorName
            ? [
                { forwardedTo: { equals: actorName, mode: 'insensitive' as const } },
                { assignedStaff: { equals: actorName, mode: 'insensitive' as const } },
              ]
            : []),
          ...(actorEmail
            ? [{ forwardedTo: { equals: actorEmail, mode: 'insensitive' as const } }]
            : []),
        ],
      },
    });
  }

  return prisma.messageThread.findFirst({
    where: {
      id: threadId,
      organizationId: input.organizationId,
      client: clientAccessWhere(input),
    },
  });
}

export async function listThreadMessages(input: {
  threadId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  limit?: number;
  before?: string | null;
}) {
  if (!canAccessClientMessages(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  const thread = await getThreadForActor(input.threadId, input);
  if (!thread) return { ok: false as const, status: 404, error: 'Thread not found' };

  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 100) : 30;

  let beforeMsg: { id: string; createdAt: Date } | null = null;
  if (input.before) {
    beforeMsg = await prisma.threadMessage.findFirst({
      where: { id: input.before, threadId: thread.id },
      select: { id: true, createdAt: true },
    });
  }

  const whereClause: any = { threadId: thread.id };
  if (beforeMsg) {
    whereClause.createdAt = { lt: beforeMsg.createdAt };
  }

  const rows = await prisma.threadMessage.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const sortedDesc = [...rows].sort((a, b) => {
    const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });
  const hasMore = sortedDesc.length > limit;
  const sliced = hasMore ? sortedDesc.slice(0, limit) : sortedDesc;
  const chronological = sliced.sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  return {
    ok: true as const,
    thread: serializeThread(thread),
    messages: chronological.map(serializeMessage),
    hasMore,
    oldestMessageId: chronological[0]?.id ?? null,
  };
}

export async function markThreadRead(input: {
  threadId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}) {
  if (!canAccessClientMessages(input.actorRole)) return null;
  const thread = await getThreadForActor(input.threadId, input);
  if (!thread) return null;

  await prisma.$transaction([
    prisma.threadMessage.updateMany({
      where: { threadId: thread.id, senderType: 'PATIENT', read: false },
      data: { read: true },
    }),
    prisma.messageThread.update({
      where: { id: thread.id },
      data: {
        unreadCount: 0,
        status:
          thread.status === 'WAITING' ? 'IN_PROGRESS' : thread.status,
      },
    }),
  ]);

  return prisma.messageThread.findUnique({ where: { id: thread.id } });
}

export async function sendThreadMessage(input: {
  threadId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  content: string;
  actorName?: string | null;
}) {
  if (!canAccessClientMessages(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  const content = input.content.trim();
  if (content.length < 1) {
    return { ok: false as const, status: 400, error: 'Message cannot be empty' };
  }
  if (content.length > 4000) {
    return { ok: false as const, status: 400, error: 'Message is too long' };
  }

  const thread = await getThreadForActor(input.threadId, input);
  if (!thread) return { ok: false as const, status: 404, error: 'Thread not found' };

  const senderName = input.actorName?.trim() || 'Front Office';
  const now = new Date();

  const { created, updated } = await prisma.$transaction(async (tx) => {
    const created = await tx.threadMessage.create({
      data: {
        threadId: thread.id,
        senderType: 'FRONT_OFFICE',
        senderName,
        content,
        // Read receipts describe whether the recipient has read this reply.
        read: false,
        createdAt: now,
      },
    });
    const updated = await tx.messageThread.update({
      where: { id: thread.id },
      data: { lastMessage: content, lastMessageAt: now, status: 'IN_PROGRESS' },
    });
    return { created, updated };
  });

  const serializedMsg = serializeMessage(created);
  const serializedThread = serializeThread(updated);

  publishRealtimeMessage({
    type: 'new_message',
    threadId: thread.id,
    senderType: 'FRONT_OFFICE',
    staffMessage: serializedMsg,
    patientMessage: {
      id: created.id,
      threadId: thread.id,
      senderRole: 'clinician',
      senderName,
      body: content,
      read: false,
      createdAt: created.createdAt.toISOString(),
    },
  });

  const unreadCountForPatient = await prisma.threadMessage.count({
    where: {
      thread: { clientId: thread.clientId, organizationId: thread.organizationId },
      senderType: 'FRONT_OFFICE',
      read: false,
    },
  });

  void sendToUser(thread.clientId, {
    type: 'chat_message',
    title: `New message from ${senderName}`,
    body: content.length > 100 ? content.slice(0, 97) + '...' : content,
    data: {
      conversationId: thread.id,
      threadId: thread.id,
      senderId: input.actorUserId,
      senderName,
      unreadCount: String(unreadCountForPatient),
      badge: String(unreadCountForPatient),
      lastMessage: content,
      body: content,
    },
  }).catch((err) => {
    console.warn('[FCM] Chat push notification failed:', err);
  });

  return {
    ok: true as const,
    message: serializedMsg,
    thread: serializedThread,
  };
}

export async function patchMessageThread(input: {
  threadId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  status?: string | null;
  forwardedTo?: string | null;
  forwardNote?: string | null;
  assignedStaff?: string | null;
  actorName?: string | null;
}) {
  if (!canAccessClientMessages(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }
  const thread = await getThreadForActor(input.threadId, input);
  if (!thread) return { ok: false as const, status: 404, error: 'Thread not found' };

  const data: {
    status?: MessageThreadStatus;
    forwardedTo?: string | null;
    assignedStaff?: string | null;
    lastMessage?: string;
    lastMessageAt?: Date;
  } = {};

  if (input.assignedStaff != null) {
    data.assignedStaff = input.assignedStaff.trim() || null;
  }

  const forwarding = Boolean(input.forwardedTo?.trim());
  if (forwarding) {
    const to = input.forwardedTo!.trim();
    data.forwardedTo = to;
    data.status = 'FORWARDED';
    const note =
      input.forwardNote?.trim() ||
      `Forwarded to ${to} for clinical follow-up.`;
    const now = new Date();
    const createdNote = await prisma.threadMessage.create({
      data: {
        threadId: thread.id,
        senderType: 'CLINICIAN_NOTE',
        senderName: input.actorName?.trim() || 'Front Office',
        content: note,
        read: true,
        createdAt: now,
      },
    });
    data.lastMessage = note;
    data.lastMessageAt = now;

    publishRealtimeMessage({
      type: 'new_message',
      threadId: thread.id,
      senderType: 'CLINICIAN_NOTE',
      staffMessage: serializeMessage(createdNote),
    });
  } else if (input.status) {
    const st = STATUS_DB[input.status];
    if (!st) {
      return { ok: false as const, status: 400, error: 'Invalid status' };
    }
    data.status = st;
    if (st === 'RESOLVED') {
      data.lastMessageAt = new Date();
    }
  }

  if (Object.keys(data).length === 0) {
    return { ok: false as const, status: 400, error: 'No updates provided' };
  }

  const updated = await prisma.messageThread.update({
    where: { id: thread.id },
    data,
  });

  return { ok: true as const, thread: serializeThread(updated) };
}

export async function findThreadIdByClient(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}) {
  const thread = await prisma.messageThread.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      client: clientAccessWhere(input),
    },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  });
  return thread?.id ?? null;
}

export async function getOrCreateThreadForClient(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorName?: string | null;
  topic?: string;
}) {
  if (!canAccessClientMessages(input.actorRole)) {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  const existingId = await findThreadIdByClient(input);
  if (existingId) {
    const existing = await prisma.messageThread.findUnique({
      where: { id: existingId },
    });
    if (existing) {
      return { ok: true as const, thread: serializeThread(existing) };
    }
  }

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientAccessWhere(input) },
  });
  if (!client) {
    return { ok: false as const, status: 404, error: 'Client not found' };
  }

  const topic = (input.topic && TOPIC_DB[input.topic]) || 'GENERAL';

  const created = await prisma.messageThread.create({
    data: {
      organizationId: input.organizationId,
      clientId: client.id,
      clientName: client.name,
      topic,
      status: 'IN_PROGRESS',
      risk: client.riskLevel,
      assignedStaff: input.actorName || 'Front Office',
      lastMessage: '',
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
  });

  return { ok: true as const, thread: serializeThread(created) };
}

/** Legacy helpers kept for older /api/messages/[clientId] routes */
export async function listClientMessages(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<
  | { ok: true; messages: ChatMessageDto[]; clientName: string }
  | { ok: false; status: number; error: string }
> {
  const threadId = await findThreadIdByClient(input);
  if (!threadId) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, ...clientAccessWhere(input) },
      select: { name: true },
    });
    if (!client) return { ok: false, status: 404, error: 'Client not found' };
    return { ok: true, messages: [], clientName: client.name };
  }
  const result = await listThreadMessages({ ...input, threadId });
  if (result.ok === false) {
    return { ok: false, status: result.status, error: result.error };
  }
  return {
    ok: true,
    messages: result.messages,
    clientName: result.thread.clientName,
  };
}

export async function sendStaffMessage(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  content: string;
  actorName?: string | null;
}) {
  let threadId = await findThreadIdByClient(input);
  if (!threadId) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, ...clientAccessWhere(input) },
    });
    if (!client) return { ok: false as const, status: 404, error: 'Client not found' };
    const created = await prisma.messageThread.create({
      data: {
        organizationId: input.organizationId,
        clientId: client.id,
        clientName: client.name,
        topic: 'GENERAL',
        status: 'IN_PROGRESS',
        risk: client.riskLevel,
        assignedStaff: input.actorName || 'Front Office',
        lastMessage: '',
        lastMessageAt: new Date(),
        unreadCount: 0,
      },
    });
    threadId = created.id;
  }
  return sendThreadMessage({ ...input, threadId });
}

export async function markClientMessagesRead(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}) {
  const threadId = await findThreadIdByClient(input);
  if (!threadId) return;
  await markThreadRead({ ...input, threadId });
}

export { TOPIC_DB, STATUS_DB };
