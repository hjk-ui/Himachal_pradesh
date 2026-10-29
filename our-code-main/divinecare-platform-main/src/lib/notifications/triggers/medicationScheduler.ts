import { prisma } from '@/lib/db/prisma';
import { sendToUser } from '../pushService';

/** Minutes-before window so a 5-min cron still hits ~15 min early. */
const REMIND_BEFORE_MIN = 10;
const REMIND_BEFORE_MAX = 20;

export interface MedicationReminderResult {
  checkedCount: number;
  sentCount: number;
  skippedAlreadyTaken: number;
  skippedAlreadySent: number;
  errors: string[];
}

function localParts(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';

  // Some runtimes return "24" for midnight with hour12:false
  let hour = parseInt(get('hour') || '0', 10);
  if (hour === 24) hour = 0;

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: parseInt(get('minute') || '0', 10),
  };
}

/**
 * Active schedules: for each doseTime, send one FCM reminder ~15 minutes before
 * (window 10–20 min early). Deduped per schedule/day/dose.
 */
export async function checkMedicationReminders(now: Date = new Date()): Promise<MedicationReminderResult> {
  const result: MedicationReminderResult = {
    checkedCount: 0,
    sentCount: 0,
    skippedAlreadyTaken: 0,
    skippedAlreadySent: 0,
    errors: [],
  };

  try {
    const activeSchedules = await prisma.medicationSchedule.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      include: {
        client: {
          select: { id: true, name: true, location: { select: { timezone: true } } },
        },
      },
    });

    result.checkedCount = activeSchedules.length;

    for (const schedule of activeSchedules) {
      const timezone = schedule.client.location?.timezone || 'America/New_York';
      const { year, month, day, hour, minute } = localParts(now, timezone);
      const currentMinutes = hour * 60 + minute;
      const dateStr = `${year}-${month}-${day}`;

      for (const doseTime of schedule.doseTimes) {
        const [doseHourStr, doseMinuteStr] = doseTime.split(':');
        const doseHour = parseInt(doseHourStr || '0', 10);
        const doseMin = parseInt(doseMinuteStr || '0', 10);
        if (Number.isNaN(doseHour) || Number.isNaN(doseMin)) continue;

        const targetMinutes = doseHour * 60 + doseMin;

        // Minutes until dose (handle midnight wrap)
        let minutesUntil = targetMinutes - currentMinutes;
        if (minutesUntil <= -720) minutesUntil += 1440;
        else if (minutesUntil > 720) minutesUntil -= 1440;

        // Only ~15 minutes BEFORE dose (not at/after)
        if (minutesUntil < REMIND_BEFORE_MIN || minutesUntil > REMIND_BEFORE_MAX) {
          continue;
        }

        // Dedupe date = calendar day of the dose (may be tomorrow if wrapped)
        let doseDateStr = dateStr;
        if (targetMinutes < currentMinutes && minutesUntil > 0) {
          const doseInstant = new Date(now.getTime() + minutesUntil * 60 * 1000);
          const doseLocal = localParts(doseInstant, timezone);
          doseDateStr = `${doseLocal.year}-${doseLocal.month}-${doseLocal.day}`;
        }

        const dedupeKey = `med:${schedule.id}:${doseDateStr}:${doseTime}`;

        const alreadySent = await prisma.notificationLog.findUnique({
          where: { dedupeKey },
        });
        if (alreadySent) {
          result.skippedAlreadySent++;
          continue;
        }

        const scheduledDoseTime = new Date(now.getTime() + minutesUntil * 60 * 1000);
        scheduledDoseTime.setSeconds(0, 0);

        const windowStart = new Date(scheduledDoseTime.getTime() - 45 * 60 * 1000);
        const windowEnd = new Date(scheduledDoseTime.getTime() + 45 * 60 * 1000);

        const alreadyTaken = await prisma.medicationIntakeLog.findFirst({
          where: {
            scheduleId: schedule.id,
            clientId: schedule.clientId,
            scheduledFor: {
              gte: windowStart,
              lte: windowEnd,
            },
            takenAt: { not: null },
          },
        });

        if (alreadyTaken) {
          result.skippedAlreadyTaken++;
          continue;
        }

        const pushResult = await sendToUser(schedule.clientId, {
          type: 'medication_reminder',
          title: 'Medication in 15 minutes 💊',
          body: `Reminder: take ${schedule.medicationName} (${schedule.dosage}) at ${doseTime}${
            schedule.instructions ? ' — ' + schedule.instructions : ''
          }`,
          dedupeKey,
          data: {
            medicationId: schedule.id,
            medicationName: schedule.medicationName,
            dosage: schedule.dosage,
            doseTime,
            scheduledTime: scheduledDoseTime.toISOString(),
            route: '/medications',
          },
        });

        if (pushResult.sentCount > 0 && !pushResult.isMock) {
          result.sentCount++;
        } else if (pushResult.error && !pushResult.isMock) {
          result.errors.push(
            `${schedule.medicationName}@${doseTime}: ${pushResult.error}`
          );
        }
      }
    }
  } catch (err: any) {
    result.errors.push(err?.message || 'Medication reminder execution failed');
  }

  return result;
}
