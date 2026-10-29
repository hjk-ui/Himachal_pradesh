import { prisma } from '@/lib/db/prisma';
import { getFirebaseAdmin } from './firebaseAdmin';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { recordPatientNotification } from '@/patient/application/notifications/service';

export type NotificationType =
  | 'medication_reminder'
  | 'appointment_reminder'
  | 'telehealth_call'
  | 'chat_message'
  | 'check_in_reminder';

export interface PushNotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
}

export interface PushResult {
  success: boolean;
  sentCount: number;
  failureCount: number;
  isMock: boolean;
  messageId?: string;
  error?: string;
}

const CHANNEL_MAP: Record<NotificationType, string> = {
  medication_reminder: 'medication_reminders',
  appointment_reminder: 'appointment_reminders',
  telehealth_call: 'telehealth_calls',
  chat_message: 'chat_messages',
  check_in_reminder: 'check_in_reminders',
};

/**
 * Dispatches a push notification to all registered mobile device tokens for a patient/client.
 * Handles FCM payload structure, deduplication check, and automatic pruning of invalid/expired tokens.
 */
export async function sendToUser(
  clientId: string,
  payload: PushNotificationPayload
): Promise<PushResult> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { organizationId: true },
  });
  if (!client?.organizationId) {
    return {
      success: false,
      sentCount: 0,
      failureCount: 0,
      isMock: false,
      error: 'Client or organization not found',
    };
  }

  // Store history first so the in-app notification remains available even if
  // the patient has no token or FCM delivery fails.
  const historyType = payload.data?.type?.trim() || payload.type;
  await recordPatientNotification({
    clientId,
    organizationId: client.organizationId,
    type: historyType,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    dedupeKey: payload.dedupeKey,
  });

  // Deduplication check: if dedupeKey is supplied and already recorded, skip sending
  if (payload.dedupeKey && prisma?.notificationLog?.findUnique) {
    const existing = await prisma.notificationLog.findUnique({
      where: { dedupeKey: payload.dedupeKey },
    });
    if (existing) {
      return {
        success: true,
        sentCount: 0,
        failureCount: 0,
        isMock: false,
        error: 'Duplicate notification suppressed',
      };
    }
  }

  // Retrieve active device tokens for the patient
  if (!prisma?.deviceToken?.findMany) {
    return {
      success: true,
      sentCount: 0,
      failureCount: 0,
      isMock: true,
    };
  }

  const deviceTokens = await prisma.deviceToken.findMany({
    where: { clientId },
    select: { id: true, token: true, platform: true },
  });

  if (deviceTokens.length === 0) {
    return {
      success: true,
      sentCount: 0,
      failureCount: 0,
      isMock: false,
      error: 'No active device tokens found for client',
    };
  }

  const { app, isMock } = getFirebaseAdmin();
  const tokens = deviceTokens.map((d) => d.token);
  const channelId = CHANNEL_MAP[payload.type] || 'general_notifications';

  // 1. Simulation / Mock Mode (when Firebase credentials are not set in dev, or test tokens are used)
  const allTestTokens = tokens.every(
    (t) => t.startsWith('mock-') || t.startsWith('test-') || t.startsWith('fcm-')
  );

  if (isMock || !app || allTestTokens) {
    // Do not write NotificationLog in mock — otherwise live-with-missing-Firebase
    // would permanently suppress real retries after credentials are fixed.
    return {
      success: false,
      sentCount: 0,
      failureCount: tokens.length,
      isMock: isMock || allTestTokens,
      error: isMock
        ? 'Firebase Admin not configured (mock mode)'
        : 'Test/mock device tokens only — no real FCM send',
    };
  }

  // 2. Real FCM Dispatch via Firebase Admin SDK
  try {
    const rawBadge = payload.data?.unreadCount || payload.data?.badge || payload.data?.count;
    const badgeCount = rawBadge ? Math.max(1, parseInt(rawBadge, 10) || 1) : 1;

    const fcmMessage: MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        type: payload.type,
        ...(payload.data ?? {}),
        badge: String(badgeCount),
        unreadCount: String(badgeCount),
        count: String(badgeCount),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            sound: 'default',
            badge: badgeCount,
            'content-available': 1,
          },
        },
      },
      android: {
        priority: 'high',
        notification: {
          title: payload.title,
          body: payload.body,
          sound: 'default',
          channelId,
          priority: 'max',
          visibility: 'public',
          defaultSound: true,
          defaultVibrateTimings: true,
          notificationCount: badgeCount,
        },
      },
    };

    const messaging = getMessaging(app);
    const response = await messaging.sendEachForMulticast(fcmMessage);

    // Identify stale or unregistered tokens to prune
    const invalidTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success && res.error) {
        const code = res.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(tokens[idx]!);
        }
      }
    });

    if (invalidTokens.length > 0) {
      await prisma.deviceToken.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    }

    // Only dedupe-log real deliveries — failed sends must be retryable on next cron
    if (payload.dedupeKey && response.successCount > 0) {
      try {
        await prisma.notificationLog.create({
          data: {
            clientId,
            type: payload.type,
            dedupeKey: payload.dedupeKey,
            title: payload.title,
            body: payload.body,
            payload: (payload.data as any) ?? {},
            successCount: response.successCount,
            failureCount: response.failureCount,
          },
        });
      } catch (logErr: any) {
        // Race with parallel cron: unique dedupeKey is fine
        if (logErr?.code !== 'P2002') {
          console.warn('[FCM] notificationLog create failed:', logErr);
        }
      }
    }

    return {
      success: response.successCount > 0,
      sentCount: response.successCount,
      failureCount: response.failureCount,
      isMock: false,
      error:
        response.successCount === 0
          ? 'FCM delivered to 0 devices (tokens may be invalid)'
          : undefined,
    };
  } catch (err: any) {
    console.error('[FCM] Error dispatching push notification:', err);
    return {
      success: false,
      sentCount: 0,
      failureCount: tokens.length,
      isMock: false,
      error: err?.message || 'FCM dispatch failure',
    };
  }
}
