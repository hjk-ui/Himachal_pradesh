import { prisma } from '@/lib/db/prisma';
import { sendToUser } from '../pushService';

export interface CheckInReminderResult {
  sentCount: number;
  skippedAlreadyCheckedIn: number;
  skippedAlreadySent: number;
  errors: string[];
}

/**
 * Sends a daily check-in prompt to active patients who have not yet submitted
 * their check-in today.
 */
export async function checkDailyCheckIns(now: Date = new Date()): Promise<CheckInReminderResult> {
  const result: CheckInReminderResult = {
    sentCount: 0,
    skippedAlreadyCheckedIn: 0,
    skippedAlreadySent: 0,
    errors: [],
  };

  try {
    const todayStr = now.toISOString().split('T')[0]!;
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // Active clients with a registered mobile device
    const clientsWithDevices = await prisma.client.findMany({
      where: {
        active: true,
        status: 'ACTIVE',
        deviceTokens: { some: {} },
      },
      select: {
        id: true,
        name: true,
        checkIns: {
          where: {
            createdAt: { gte: startOfDay },
          },
          select: { id: true },
        },
      },
    });

    for (const client of clientsWithDevices) {
      // 1. Skip if patient has already submitted a check-in today
      if (client.checkIns.length > 0) {
        result.skippedAlreadyCheckedIn++;
        continue;
      }

      // 2. Skip if already sent today
      const dedupeKey = `checkin:${client.id}:${todayStr}`;
      const alreadySent = await prisma.notificationLog.findUnique({
        where: { dedupeKey },
      });
      if (alreadySent) {
        result.skippedAlreadySent++;
        continue;
      }

      // 3. Dispatch check-in reminder
      const pushResult = await sendToUser(client.id, {
        type: 'check_in_reminder',
        title: 'Daily Wellness Check-in',
        body: `How are you feeling today? Tap to record your daily check-in.`,
        dedupeKey,
        data: {
          date: todayStr,
        },
      });

      if (pushResult.sentCount > 0) {
        result.sentCount++;
      }
    }
  } catch (err: any) {
    result.errors.push(err?.message || 'Daily check-in reminder execution failed');
  }

  return result;
}
