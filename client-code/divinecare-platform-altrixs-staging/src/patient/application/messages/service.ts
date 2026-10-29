import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PatientAppError, type PatientContext } from '@/patient/domain';
import { logPatientAudit, proxyAuditFields } from '@/patient/infrastructure/persistence/audit';
import { proxySenderLabel } from '@/patient/domain/proxy-policy';
import { publishRealtimeMessage } from '@/lib/messages/realtime';
import { formatRelativeTime, formatTimeOfDay } from '@/lib/date/relativeTime';
import { patientMessageSafety } from '@/lib/ai/riskWatch/patientMessage';

const MAX_MESSAGE = 4000;

/**
 * Portal thread scope. A proxy (guardian / representative) sees only the threads it opened; the
 * client's own login sees only its own threads, never a proxy's (and a proxy never sees the
 * client's private messages). Staff see every thread of the client in the dashboard.
 */
function threadScope(ctx: PatientContext) {
  return {
    clientId: ctx.clientId,
    organizationId: ctx.organizationId,
    proxyPortalUserId: ctx.access?.isProxy ? ctx.accountId : null,
  };
}

/** Sender label staff see: the client's name, or "Guardian Name (parent of Alex)" for a proxy. */
function senderLabel(ctx: PatientContext) {
  if (!ctx.access?.isProxy) return ctx.clientName;
  const first = (ctx.clientName || '').trim().split(/\s+/)[0] || 'client';
  return proxySenderLabel(ctx.access.actorName, ctx.access.relationship, first);
}

const visibleSenders = ['PATIENT', 'FRONT_OFFICE'] as const;
const patientThreadInclude = {
  messages: {
    where: { senderType: { in: [...visibleSenders] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
  _count: { select: { messages: { where: { senderType: 'FRONT_OFFICE', read: false } } } },
} satisfies Prisma.MessageThreadInclude;

type PatientThread = Prisma.MessageThreadGetPayload<{ include: typeof patientThreadInclude }>;

function serializeVisibleThread(row: PatientThread) {
  const latest = row.messages[0];
  const lastMsg = latest?.content || row.lastMessage || '';
  const lastDate = latest?.createdAt || row.lastMessageAt || null;
  const unread = row._count?.messages ?? 0;

  return serializeThread({
    ...row,
    lastMessage: lastMsg,
    lastMessageAt: lastDate,
    unreadCount: unread,
  });
}

function serializeThread(row: {
  id: string;
  topic: string;
  status: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  assignedStaff: string | null;
}) {
  const lastMsg = row.lastMessage || '';
  const isoTime = row.lastMessageAt?.toISOString() ?? null;
  const timeStr = row.lastMessageAt ? formatRelativeTime(row.lastMessageAt) : '';
  const staff = row.assignedStaff || 'Front Office';

  return {
    id: row.id,
    topic: row.topic.toLowerCase().replace('_', '-'),
    status: row.status.toLowerCase().replace('_', '-'),
    lastMessage: lastMsg,
    last_message: lastMsg,
    latestMessage: lastMsg,
    latest_message: lastMsg,
    preview: lastMsg,
    message: lastMsg,
    content: lastMsg,
    body: lastMsg,
    lastMessageAt: isoTime,
    last_message_at: isoTime,
    timestamp: isoTime,
    time: timeStr,
    lastTime: timeStr,
    last_time: timeStr,
    lastMessageTime: timeStr,
    last_message_time: timeStr,
    assignedStaff: staff,
    assigned_staff: staff,
    staffName: staff,
    staff_name: staff,
    unreadCount: row.unreadCount,
    unread_count: row.unreadCount,
    unread: row.unreadCount,
    unreadMessages: row.unreadCount,
    unread_messages: row.unreadCount,
    badge: row.unreadCount,
    count: row.unreadCount,
  };
}

function serializeMessage(row: {
  id: string;
  threadId: string;
  senderType: string;
  senderName: string;
  content: string;
  read: boolean;
  createdAt: Date;
}) {
  const isPatient = row.senderType === 'PATIENT';
  const iso = row.createdAt.toISOString();
  const timeStr = formatTimeOfDay(row.createdAt);
  return {
    id: row.id,
    threadId: row.threadId,
    senderRole: (isPatient ? 'patient' : 'clinician') as 'patient' | 'clinician',
    sender_role: isPatient ? 'patient' : 'clinician',
    senderType: row.senderType,
    sender_type: isPatient ? 'patient' : 'clinician',
    sender: (isPatient ? 'me' : 'office') as 'me' | 'office',
    senderName: row.senderName,
    sender_name: row.senderName,
    senderId: isPatient ? 'client' : 'staff',
    body: row.content,
    content: row.content,
    message: row.content,
    text: row.content,
    isPatient,
    isUser: isPatient,
    isMe: isPatient,
    read: row.read,
    createdAt: iso,
    created_at: iso,
    timestamp: iso,
    time: timeStr,
  };
}

async function getOwnThread(ctx: PatientContext, threadId: string) {
  return prisma.messageThread.findFirst({
    where: { id: threadId, ...threadScope(ctx) },
    include: patientThreadInclude,
  });
}

export async function verifyPatientThreadAccess(ctx: PatientContext, threadId: string) {
  const thread = await getOwnThread(ctx, threadId);
  if (!thread) {
    throw new PatientAppError('Conversation not found', 404, 'NOT_FOUND');
  }
  return thread;
}

export async function listPatientConversations(ctx: PatientContext) {
  const rows = await prisma.messageThread.findMany({
    where: threadScope(ctx),
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    include: patientThreadInclude,
    take: 100,
  });

  return rows.map(serializeVisibleThread).sort((a, b) =>
    (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')
  );
}

export async function getLatestPatientConversation(ctx: PatientContext) {
  const latest = await prisma.threadMessage.findFirst({
    where: {
      thread: threadScope(ctx),
      senderType: { in: [...visibleSenders] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { thread: { include: patientThreadInclude } },
  });
  if (latest) {
    return serializeVisibleThread(latest.thread);
  }
  const fallbackThread = await prisma.messageThread.findFirst({
    where: threadScope(ctx),
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    include: patientThreadInclude,
  });
  return fallbackThread ? serializeVisibleThread(fallbackThread) : null;
}

export async function createPatientConversation(
  ctx: PatientContext,
  input: { topic?: string; message: string }
) {
  const body = input.message.trim();
  if (!body) {
    throw new PatientAppError('Message cannot be empty', 400, 'VALIDATION_ERROR');
  }
  if (body.length > MAX_MESSAGE) {
    throw new PatientAppError('Message is too long', 400, 'VALIDATION_ERROR');
  }

  const topicMap: Record<string, 'GENERAL' | 'SCHEDULING' | 'BILLING' | 'CLINICAL' | 'RX_REFILL'> = {
    general: 'GENERAL',
    scheduling: 'SCHEDULING',
    billing: 'BILLING',
    clinical: 'CLINICAL',
    'rx-refill': 'RX_REFILL',
  };
  const topic = topicMap[input.topic || 'general'];
  if (!topic) throw new PatientAppError('Invalid conversation topic', 400, 'VALIDATION_ERROR');
  const now = new Date();

  const { thread, message } = await prisma.$transaction(async (tx) => {
    const created = await tx.messageThread.create({
      data: {
        organizationId: ctx.organizationId,
        clientId: ctx.clientId,
        clientName: ctx.clientName,
        ...(ctx.access?.isProxy ? { proxyPortalUserId: ctx.accountId } : {}),
        topic,
        status: 'WAITING',
        assignedStaff: ctx.assignedClinicianName,
        lastMessage: body,
        lastMessageAt: now,
        unreadCount: 1,
      },
    });

    const msg = await tx.threadMessage.create({
      data: {
        threadId: created.id,
        senderType: 'PATIENT',
        senderName: senderLabel(ctx),
        content: body,
        read: false,
        sentByPortalUserId: ctx.accountId,
      },
    });

    return { thread: created, message: msg };
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    ...proxyAuditFields(ctx),
    action: 'conversation.created',
    entityType: 'conversation',
    entityId: thread.id,
  });

  publishRealtimeMessage({
    type: 'new_message',
    threadId: thread.id,
    senderType: 'PATIENT',
    staffMessage: {
      id: message.id,
      threadId: thread.id,
      senderType: 'patient',
      senderId: 'client',
      senderName: senderLabel(ctx),
      content: body,
      read: false,
      createdAt: message.createdAt.toISOString(),
      timestamp: 'just now',
    },
    patientMessage: serializeMessage(message),
  });

  // Risk language watch: alerts the care team; `safety` = crisis resources for the portal (additive)
  const safety = await patientMessageSafety({ organizationId: ctx.organizationId, clientId: ctx.clientId, threadId: thread.id, messageId: message.id, text: body });
  return { ...serializeThread({ ...thread, topic: thread.topic, status: thread.status, unreadCount: 0 }), safety };
}

export async function listPatientMessages(
  ctx: PatientContext,
  threadId: string,
  skip: number,
  limit: number,
  before?: string | null
) {
  const thread = await getOwnThread(ctx, threadId);
  if (!thread) {
    throw new PatientAppError('Conversation not found', 404, 'NOT_FOUND');
  }

  const total = await prisma.threadMessage.count({
    where: { threadId, senderType: { in: [...visibleSenders] } },
  });

  let beforeMsg: { id: string; createdAt: Date } | null = null;
  if (before) {
    beforeMsg = await prisma.threadMessage.findFirst({
      where: { id: before, threadId, senderType: { in: [...visibleSenders] } },
      select: { id: true, createdAt: true },
    });
  }

  let rows: Array<{
    id: string;
    threadId: string;
    senderType: string;
    senderName: string;
    content: string;
    read: boolean;
    createdAt: Date;
  }>;
  let hasMore = false;

  if (beforeMsg) {
    // Cursor-based reverse loading (older messages before cursor)
    const raw = await prisma.threadMessage.findMany({
      where: {
        threadId,
        senderType: { in: [...visibleSenders] },
        createdAt: { lt: beforeMsg.createdAt },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const sortedDesc = [...raw].sort((a, b) => {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });
    hasMore = sortedDesc.length > limit;
    const sliced = hasMore ? sortedDesc.slice(0, limit) : sortedDesc;
    rows = sliced.sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  } else if (skip === 0) {
    // Initial fetch: latest messages (WhatsApp / Instagram default view)
    const raw = await prisma.threadMessage.findMany({
      where: { threadId, senderType: { in: [...visibleSenders] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const sortedDesc = [...raw].sort((a, b) => {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });
    hasMore = sortedDesc.length > limit;
    const sliced = hasMore ? sortedDesc.slice(0, limit) : sortedDesc;
    rows = sliced.sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  } else {
    // Reverse window by skip/page
    const offsetFromEnd = skip + limit;
    const skipFromStart = Math.max(0, total - offsetFromEnd);
    const takeCount = Math.min(limit, Math.max(0, total - skip));
    hasMore = skipFromStart > 0;
    const raw = await prisma.threadMessage.findMany({
      where: { threadId, senderType: { in: [...visibleSenders] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: skipFromStart,
      take: takeCount,
    });
    rows = [...raw].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }

  const oldestMessageId = rows[0]?.id ?? null;

  return {
    conversation: serializeVisibleThread(thread),
    messages: rows.map(serializeMessage),
    hasMore,
    oldestMessageId,
    pagination: {
      total,
      page: Math.floor(skip / limit) + 1,
      limit,
      hasMore,
      has_more: hasMore,
      oldestMessageId,
      nextBefore: oldestMessageId,
    },
  };
}

export async function sendPatientMessage(
  ctx: PatientContext,
  threadId: string,
  content: string
) {
  const body = content.trim();
  if (!body) {
    throw new PatientAppError('Message cannot be empty', 400, 'VALIDATION_ERROR');
  }
  if (body.length > MAX_MESSAGE) {
    throw new PatientAppError('Message is too long', 400, 'VALIDATION_ERROR');
  }

  const thread = await getOwnThread(ctx, threadId);
  if (!thread) {
    throw new PatientAppError('Conversation not found', 404, 'NOT_FOUND');
  }

  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.threadMessage.create({
      data: {
        threadId,
        senderType: 'PATIENT',
        senderName: senderLabel(ctx),
        content: body,
        read: false,
        sentByPortalUserId: ctx.accountId,
      },
    });

    await tx.messageThread.update({
      where: { id: threadId },
      data: {
        lastMessage: body,
        lastMessageAt: now,
        status: 'WAITING',
        unreadCount: { increment: 1 },
      },
    });

    return created;
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    ...proxyAuditFields(ctx),
    action: 'message.sent',
    entityType: 'message',
    entityId: message.id,
  });

  const serializedMsg = serializeMessage(message);

  publishRealtimeMessage({
    type: 'new_message',
    threadId,
    senderType: 'PATIENT',
    staffMessage: {
      id: message.id,
      threadId,
      senderType: 'patient',
      senderId: 'client',
      senderName: senderLabel(ctx),
      content: body,
      read: false,
      createdAt: message.createdAt.toISOString(),
      timestamp: 'just now',
    },
    patientMessage: serializedMsg,
  });

  const safety = await patientMessageSafety({ organizationId: ctx.organizationId, clientId: ctx.clientId, threadId, messageId: message.id, text: body });
  return { ...serializedMsg, safety };
}

export async function markPatientMessageRead(ctx: PatientContext, messageId: string) {
  const message = await prisma.threadMessage.findFirst({
    where: {
      id: messageId,
      thread: threadScope(ctx),
      senderType: 'FRONT_OFFICE',
    },
    include: { thread: true },
  });

  if (!message) {
    throw new PatientAppError('Message not found', 404, 'NOT_FOUND');
  }

  if (!message.read) {
    await prisma.threadMessage.update({
      where: { id: message.id },
      data: { read: true },
    });

    await logPatientAudit({
      clientId: ctx.clientId,
      accountId: ctx.accountId,
      ...proxyAuditFields(ctx),
      action: 'message.read',
      entityType: 'message',
      entityId: message.id,
    });
  }

  return { id: message.id, read: true };
}

export async function markPatientConversationRead(ctx: PatientContext, threadId: string) {
  await verifyPatientThreadAccess(ctx, threadId);

  const updated = await prisma.threadMessage.updateMany({
    where: {
      threadId,
      senderType: 'FRONT_OFFICE',
      read: false,
    },
    data: { read: true },
  });

  await logPatientAudit({
    clientId: ctx.clientId,
    accountId: ctx.accountId,
    ...proxyAuditFields(ctx),
    action: 'thread.read',
    entityType: 'thread',
    entityId: threadId,
  });

  return { id: threadId, read: true, markedReadCount: updated.count };
}

