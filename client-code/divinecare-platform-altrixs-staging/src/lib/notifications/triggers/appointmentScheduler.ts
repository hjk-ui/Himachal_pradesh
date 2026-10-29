import { prisma } from '@/lib/db/prisma';
import { sendToUser } from '../pushService';
import { formatPracticeTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

export interface AppointmentReminderResult {
  checkedCount: number;
  sent24h: number;
  sent1h: number;
  sent15m: number;
  errors: string[];
}

/**
 * Checks scheduled appointments due in 24 hours, 1 hour, and 15 minutes,
 * sending push reminders with deduplication keys.
 */
export async function checkAppointmentReminders(now: Date = new Date()): Promise<AppointmentReminderResult> {
  const result: AppointmentReminderResult = {
    checkedCount: 0,
    sent24h: 0,
    sent1h: 0,
    sent15m: 0,
    errors: [],
  };

  try {
    const minTime = new Date(now.getTime() + 5 * 60 * 1000);
    const maxTime = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: {
          gte: minTime,
          lte: maxTime,
        },
      },
      include: {
        client: { select: { id: true, name: true } },
        clinician: { select: { id: true, name: true } },
      },
    });

    result.checkedCount = appointments.length;

    for (const appt of appointments) {
      const diffMs = appt.startsAt.getTime() - now.getTime();
      const diffMinutes = Math.round(diffMs / (60 * 1000));
      const doctorName = appt.clinicianName || appt.clinician?.name || 'your care provider';

      // 1. 24 Hours reminder (window: 23h to 25h = 1380 to 1500 minutes)
      if (diffMinutes >= 1380 && diffMinutes <= 1500) {
        const dedupeKey = `appt:${appt.id}:24h`;
        const pushResult = await sendToUser(appt.clientId, {
          type: 'appointment_reminder',
          title: 'Upcoming Appointment Reminder',
          // Lock screen: no clinician name or visit type (minimum necessary)
          body: `You have an appointment tomorrow at ${formatPracticeTime(
            appt.startsAt,
            await getPracticeTimeZone(appt.organizationId),
            { withZone: true }
          )}.`,
          dedupeKey,
          data: {
            appointmentId: appt.id,
            doctorName,
            scheduledAt: appt.startsAt.toISOString(),
          },
        });
        if (pushResult.sentCount > 0) result.sent24h++;
      }

      // 2. 1 Hour reminder (window: 50 to 70 minutes)
      if (diffMinutes >= 50 && diffMinutes <= 70) {
        const dedupeKey = `appt:${appt.id}:1h`;
        const pushResult = await sendToUser(appt.clientId, {
          type: 'appointment_reminder',
          title: 'Appointment in 1 Hour',
          body: 'Your appointment starts in 1 hour.',
          dedupeKey,
          data: {
            appointmentId: appt.id,
            doctorName,
            scheduledAt: appt.startsAt.toISOString(),
          },
        });
        if (pushResult.sentCount > 0) result.sent1h++;
      }

      // 3. 15 Minutes reminder (window: 10 to 20 minutes)
      if (diffMinutes >= 10 && diffMinutes <= 20) {
        const dedupeKey = `appt:${appt.id}:15m`;
        const pushResult = await sendToUser(appt.clientId, {
          type: 'appointment_reminder',
          title: 'Appointment Starting Soon',
          body: 'Your appointment begins in 15 minutes. Tap to check in.',
          dedupeKey,
          data: {
            appointmentId: appt.id,
            doctorName,
            scheduledAt: appt.startsAt.toISOString(),
          },
        });
        if (pushResult.sentCount > 0) result.sent15m++;
      }
    }
  } catch (err: any) {
    result.errors.push(err?.message || 'Appointment reminder execution failed');
  }

  return result;
}
