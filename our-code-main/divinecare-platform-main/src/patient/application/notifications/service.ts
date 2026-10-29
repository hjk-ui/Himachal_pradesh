import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';

export interface NotificationOwner {
  clientId: string;
  organizationId: string;
}

export interface RecordNotificationInput extends NotificationOwner {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface ListNotificationsOptions {
  skip?: number;
  limit?: number;
  unreadOnly?: boolean;
  type?: string;
}

export function serializePatientNotification(notification: any) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    message: notification.body,
    data: notification.data ?? {},
    isRead: Boolean(notification.isRead),
    is_read: Boolean(notification.isRead),
    readAt: notification.readAt ? new Date(notification.readAt).toISOString() : null,
    read_at: notification.readAt ? new Date(notification.readAt).toISOString() : null,
    createdAt: new Date(notification.createdAt).toISOString(),
    created_at: new Date(notification.createdAt).toISOString(),
    updatedAt: new Date(notification.updatedAt).toISOString(),
    updated_at: new Date(notification.updatedAt).toISOString(),
  };
}

/** Persist the in-app history record before push delivery is attempted. */
export async function recordPatientNotification(input: RecordNotificationInput) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!client) return null;

  const data: Prisma.PatientNotificationUncheckedCreateInput = {
    organizationId: input.organizationId,
    clientId: input.clientId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: (input.data ?? {}) as Prisma.InputJsonValue,
    dedupeKey: input.dedupeKey,
    isRead: false,
  };
  if (input.dedupeKey) {
    return prisma.patientNotification.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: data,
      update: {},
    });
  }
  return prisma.patientNotification.create({ data });
}

export async function listPatientNotifications(
  owner: NotificationOwner,
  options: ListNotificationsOptions = {}
) {
  const skip = Math.max(0, options.skip ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const ownerWhere = { clientId: owner.clientId, organizationId: owner.organizationId };
  const where = {
    ...ownerWhere,
    ...(options.unreadOnly ? { isRead: false } : {}),
    ...(options.type ? { type: options.type } : {}),
  };
  const [items, total, unreadCount] = await Promise.all([
    prisma.patientNotification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.patientNotification.count({ where }),
    prisma.patientNotification.count({ where: { ...ownerWhere, isRead: false } }),
  ]);
  const notifications = items.map(serializePatientNotification);
  return {
    notifications,
    total,
    unreadCount,
    unread_count: unreadCount,
    page: Math.floor(skip / limit) + 1,
    limit,
    hasMore: skip + notifications.length < total,
  };
}

export async function markNotificationRead(owner: NotificationOwner, notificationId: string) {
  const where = {
    id: notificationId,
    clientId: owner.clientId,
    organizationId: owner.organizationId,
  };
  const existing = await prisma.patientNotification.findFirst({ where });
  if (!existing) return null;
  const notification = existing.isRead
    ? existing
    : await prisma.patientNotification.update({
        where: { id: existing.id },
        data: { isRead: true, readAt: new Date() },
      });
  const unreadCount = await getUnreadNotificationCount(owner);
  return { ...serializePatientNotification(notification), unreadCount };
}

export async function markAllNotificationsRead(owner: NotificationOwner) {
  const now = new Date();
  const result = await prisma.patientNotification.updateMany({
    where: { ...owner, isRead: false },
    data: { isRead: true, readAt: now },
  });
  return {
    success: true,
    count: result.count,
    markedReadCount: result.count,
    readAt: now.toISOString(),
    unreadCount: 0,
  };
}

export async function deletePatientNotification(owner: NotificationOwner, notificationId: string) {
  const result = await prisma.patientNotification.deleteMany({
    where: { id: notificationId, ...owner },
  });
  return result.count > 0;
}

export async function getUnreadNotificationCount(owner: NotificationOwner): Promise<number> {
  return prisma.patientNotification.count({ where: { ...owner, isRead: false } });
}
