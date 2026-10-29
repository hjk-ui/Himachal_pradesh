import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export type NotifyMethod = 'Phone' | 'Portal message' | 'Letter' | 'In person';

export const CLOSE_LOOP_NOTIFY_METHODS: NotifyMethod[] = [
  'Phone',
  'Portal message',
  'Letter',
  'In person',
];

export type CloseLoopNotifyRecord = {
  id: string;
  itemId: string;
  clientId: string | null;
  method: NotifyMethod;
  notifiedAt: string;
  actorUserId: string;
  createdAt: string;
};

export async function listCloseLoopNotifies(
  organizationId: string
): Promise<CloseLoopNotifyRecord[]> {
  const rows = await prisma.closeLoopNotification.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    clientId: r.clientId,
    method: r.method as NotifyMethod,
    notifiedAt: r.notifiedAt.toISOString(),
    actorUserId: r.actorUserId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function recordPatientNotified(
  organizationId: string,
  input: {
    itemId: string;
    clientId?: string | null;
    method: NotifyMethod;
    notifiedAt: string;
    actorUserId: string;
  }
): Promise<CloseLoopNotifyRecord> {
  const notifiedDay = input.notifiedAt.slice(0, 10);
  const notifiedAt = new Date(input.notifiedAt);

  const existing = await prisma.closeLoopNotification.findUnique({
    where: {
      organizationId_itemId_method_notifiedDay: {
        organizationId,
        itemId: input.itemId,
        method: input.method,
        notifiedDay,
      },
    },
  });
  if (existing) {
    return {
      id: existing.id,
      itemId: existing.itemId,
      clientId: existing.clientId,
      method: existing.method as NotifyMethod,
      notifiedAt: existing.notifiedAt.toISOString(),
      actorUserId: existing.actorUserId,
      createdAt: existing.createdAt.toISOString(),
    };
  }

  const row = await prisma.closeLoopNotification.create({
    data: {
      organizationId,
      itemId: input.itemId,
      clientId: input.clientId || null,
      method: input.method,
      notifiedAt,
      notifiedDay,
      actorUserId: input.actorUserId,
    },
  });

  await writeAuditLog({
    action: 'medical.close_loop.patient_notified',
    actorUserId: input.actorUserId,
    organizationId,
    resourceType: 'close_loop',
    resourceId: input.itemId,
    metadata: {
      method: input.method,
      notifiedDay,
      clientId: input.clientId || null,
    },
  });

  return {
    id: row.id,
    itemId: row.itemId,
    clientId: row.clientId,
    method: row.method as NotifyMethod,
    notifiedAt: row.notifiedAt.toISOString(),
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
