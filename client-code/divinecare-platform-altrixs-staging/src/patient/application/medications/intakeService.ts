import { prisma } from '@/lib/db/prisma';

export interface RecordIntakeInput {
  clientId: string;
  scheduleId?: string;
  schedule_id?: string;
  medicationId?: string;
  medication_id?: string;
  id?: string;
  medicationScheduleId?: string;
  medication_schedule_id?: string;
  medicationName?: string;
  medication_name?: string;
  name?: string;
  scheduledFor?: string | number | Date;
  scheduled_for?: string | number | Date;
  time?: string;
  doseTime?: string;
  dose_time?: string;
  scheduledTime?: string;
  scheduled_time?: string;
  date?: string;
  timestamp?: number | string;
  taken?: boolean | string | number;
  is_taken?: boolean | string | number;
  skipped?: boolean | string | number;
  status?: string;
  action?: string;
  [key: string]: unknown;
}

export interface IntakeResult {
  success: boolean;
  recorded: boolean;
  doseId: string;
  id: string;
  scheduleId: string;
  medicationName: string;
  time: string;
  scheduledFor: string;
  taken: boolean;
  takenAt: string | null;
  skipped: boolean;
  status: 'taken' | 'skipped' | 'pending';
  message: string;
  log: unknown;
}

export interface IntakeOperationResult {
  ok: boolean;
  data?: IntakeResult;
  error?: string;
  status: number;
}


/**
 * Parses any incoming time or date string/number into a valid Date object.
 * Supports:
 * - 12-hour: "8:00 AM", "01:30 PM", "8:00am", "8:00"
 * - 24-hour: "08:00", "13:00", "20:00", "08:00:00"
 * - ISO string: "2026-09-16T08:00:00.000Z", "2026-09-16 08:00:00"
 * - Milliseconds or seconds timestamp
 */
export function parseScheduledDate(raw: unknown, defaultDoseTimes?: string[]): Date {
  const now = new Date();

  if (typeof raw === 'number') {
    const d = new Date(raw > 1e11 ? raw : raw * 1000);
    if (!isNaN(d.getTime())) return d;
  }

  if (typeof raw === 'string') {
    const str = raw.trim();

    // 1. Check 12-hour format e.g. "8:00 AM", "01:30 PM", "8:00am"
    const ampmMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = parseInt(ampmMatch[2], 10);
      const isPm = ampmMatch[4].toLowerCase() === 'pm';
      if (isPm && hours < 12) hours += 12;
      if (!isPm && hours === 12) hours = 0;
      const d = new Date(now);
      d.setHours(hours, minutes, 0, 0);
      return d;
    }

    // 2. Check 24-hour format e.g. "08:00", "13:00", "8:00", "08:00:00"
    const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeOnlyMatch) {
      const hours = parseInt(timeOnlyMatch[1], 10);
      const minutes = parseInt(timeOnlyMatch[2], 10);
      const d = new Date(now);
      d.setHours(hours, minutes, 0, 0);
      return d;
    }

    // 3. ISO or Date string e.g. "2026-09-16T08:00:00" or "2026-09-16 08:00:00"
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      const d = new Date(str.replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        return d;
      }
    }
  }

  // 4. Fallback: match from schedule doseTimes
  if (defaultDoseTimes && defaultDoseTimes.length > 0) {
    const firstTime = defaultDoseTimes[0];
    const match = firstTime.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      const d = new Date(now);
      d.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
      return d;
    }
  }

  const d = new Date(now);
  d.setSeconds(0, 0);
  return d;
}

/**
 * Normalizes intake status from various action/status/taken/skipped fields.
 */
export function normalizeIntakeStatus(raw: Record<string, unknown>): { taken: boolean; skipped: boolean } {
  const statusVal = String(raw.status || raw.action || '').toLowerCase().trim();
  if (statusVal === 'skipped' || statusVal === 'skip' || statusVal === 'missed') {
    return { taken: false, skipped: true };
  }
  if (statusVal === 'taken' || statusVal === 'take' || statusVal === 'done' || statusVal === 'completed') {
    return { taken: true, skipped: false };
  }

  if (raw.skipped === true || raw.skipped === 'true' || raw.skipped === 1) {
    return { taken: false, skipped: true };
  }
  if (raw.taken === false || raw.taken === 'false' || raw.taken === 0) {
    return { taken: false, skipped: true };
  }
  if (raw.is_taken === false || raw.is_taken === 'false' || raw.is_taken === 0) {
    return { taken: false, skipped: true };
  }

  // Default to taken
  return { taken: true, skipped: false };
}

/**
 * Records a dose intake or skip event safely for any client request payload.
 */
export async function recordMedicationIntake(
  clientId: string,
  raw: Record<string, unknown>
): Promise<IntakeOperationResult> {
  const rawScheduleId =
    raw.scheduleId ??
    raw.schedule_id ??
    raw.medicationId ??
    raw.medication_id ??
    raw.id ??
    raw.medicationScheduleId ??
    raw.medication_schedule_id ??
    raw.prescriptionId ??
    raw.prescription_id;

  const rawTime =
    raw.scheduledFor ??
    raw.scheduled_for ??
    raw.time ??
    raw.doseTime ??
    raw.dose_time ??
    raw.scheduledTime ??
    raw.scheduled_time ??
    raw.date ??
    raw.timestamp;

  const { taken, skipped } = normalizeIntakeStatus(raw);

  // 1. Fetch active schedules for client
  const activeSchedules = await prisma.medicationSchedule.findMany({
    where: { clientId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  let schedule = null;
  const strId = rawScheduleId ? String(rawScheduleId).trim() : '';

  if (strId) {
    schedule = activeSchedules.find((s) => s.id === strId);
    if (!schedule) {
      schedule = await prisma.medicationSchedule.findFirst({
        where: { clientId, id: strId },
      });
    }
    if (!schedule) {
      schedule = activeSchedules.find(
        (s) =>
          s.medicationName.toLowerCase() === strId.toLowerCase() ||
          s.medicationName.toLowerCase().includes(strId.toLowerCase())
      );
    }
  }

  if (!schedule && (raw.medicationName || raw.medication_name || raw.name)) {
    const name = String(raw.medicationName || raw.medication_name || raw.name).toLowerCase().trim();
    schedule = activeSchedules.find(
      (s) =>
        s.medicationName.toLowerCase() === name ||
        s.medicationName.toLowerCase().includes(name)
    );
  }

  if (!schedule && activeSchedules.length === 1) {
    schedule = activeSchedules[0];
  }

  if (!schedule && activeSchedules.length > 0) {
    if (rawTime) {
      const tStr = String(rawTime).trim();
      schedule =
        activeSchedules.find((s) =>
          s.doseTimes.some((dt) => tStr.includes(dt) || dt.includes(tStr))
        ) || activeSchedules[0];
    } else {
      schedule = activeSchedules[0];
    }
  }

  if (!schedule) {
    return {
      ok: false,
      error: 'Medication schedule not found for patient',
      status: 404,
    };
  }

  // 2. Parse scheduled date and normalize time
  const scheduledDate = parseScheduledDate(rawTime, schedule.doseTimes);
  const targetHours = scheduledDate.getHours();
  const targetMinutes = scheduledDate.getMinutes();
  scheduledDate.setSeconds(0, 0);

  // 3. Check for existing log today matching the target hour and minute
  const dayStart = new Date(scheduledDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(scheduledDate);
  dayEnd.setHours(23, 59, 59, 999);

  const existingLogs = await prisma.medicationIntakeLog.findMany({
    where: {
      scheduleId: schedule.id,
      scheduledFor: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
  });

  const existingLog = existingLogs.find((l) => {
    const d = new Date(l.scheduledFor);
    return d.getHours() === targetHours && d.getMinutes() === targetMinutes;
  });

  let log;
  if (existingLog) {
    log = await prisma.medicationIntakeLog.update({
      where: { id: existingLog.id },
      data: {
        takenAt: taken ? new Date() : null,
        skipped,
      },
    });
  } else {
    log = await prisma.medicationIntakeLog.upsert({
      where: {
        scheduleId_scheduledFor: {
          scheduleId: schedule.id,
          scheduledFor: scheduledDate,
        },
      },
      create: {
        scheduleId: schedule.id,
        clientId,
        scheduledFor: scheduledDate,
        takenAt: taken ? new Date() : null,
        skipped,
      },
      update: {
        takenAt: taken ? new Date() : null,
        skipped,
      },
    });
  }

  const timeFormatted = `${String(targetHours).padStart(2, '0')}:${String(targetMinutes).padStart(2, '0')}`;

  return {
    ok: true,
    status: 200,
    data: {
      success: true,
      recorded: true,
      doseId: log.id,
      id: log.id,
      scheduleId: schedule.id,
      medicationName: schedule.medicationName,
      time: timeFormatted,
      scheduledFor: scheduledDate.toISOString(),
      taken: !!log.takenAt,
      takenAt: log.takenAt ? log.takenAt.toISOString() : null,
      skipped: log.skipped,
      status: log.skipped ? 'skipped' : (log.takenAt ? 'taken' : 'pending'),
      message: taken ? 'Dose recorded as taken' : 'Dose recorded as skipped',
      log,
    },
  };
}
