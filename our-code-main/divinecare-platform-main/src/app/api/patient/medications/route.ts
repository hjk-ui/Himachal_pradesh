import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import {
  patientAccountHandler,
  patientOk,
  patientOptions,
  readPatientJson,
  PATIENT_CORS,
} from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

/**
 * GET /api/patient/medications
 * Returns active medication schedules and today's dose logs for the patient app.
 */
export const GET = patientAccountHandler(async ({ me }) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const schedules = await prisma.medicationSchedule.findMany({
    where: {
      clientId: me.clientId,
      isActive: true,
    },
    include: {
      intakeLogs: {
        where: {
          scheduledFor: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        select: {
          id: true,
          scheduledFor: true,
          takenAt: true,
          skipped: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatted = schedules.map((sched) => ({
    id: sched.id,
    medicationName: sched.medicationName,
    dosage: sched.dosage,
    instructions: sched.instructions,
    doseTimes: sched.doseTimes,
    startDate: sched.startDate.toISOString(),
    endDate: sched.endDate ? sched.endDate.toISOString() : null,
    isActive: sched.isActive,
    todayDoses: sched.doseTimes.map((timeStr) => {
      const log = sched.intakeLogs.find((l) => {
        const d = new Date(l.scheduledFor);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}` === timeStr;
      });
      return {
        time: timeStr,
        taken: !!log?.takenAt,
        takenAt: log?.takenAt ? log.takenAt.toISOString() : null,
        skipped: !!log?.skipped,
      };
    }),
  }));

  return NextResponse.json(
    {
      success: true,
      medications: formatted,
      data: {
        medications: formatted,
      },
    },
    { headers: PATIENT_CORS }
  );
});

const createScheduleSchema = z.object({
  medicationName: z.string().trim().min(1),
  dosage: z.string().trim().min(1),
  instructions: z.string().trim().optional(),
  doseTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format')).min(1),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional().nullable(),
});

import { recordMedicationIntake } from '@/patient/application/medications/intakeService';

/**
 * POST /api/patient/medications
 * Adds a new medication schedule for the client OR records dose intake if intake fields are present.
 */
export const POST = patientAccountHandler(async ({ req, me }) => {
  const json = (await readPatientJson(req, true)) as Record<string, unknown>;

  // Check if this is an intake action (e.g. from Flutter tapping "Take" or "Skip")
  const isIntakeAction =
    json &&
    (json.scheduleId !== undefined ||
      json.schedule_id !== undefined ||
      json.doseTime !== undefined ||
      json.dose_time !== undefined ||
      json.time !== undefined ||
      json.scheduledFor !== undefined ||
      json.scheduled_for !== undefined ||
      json.action !== undefined ||
      json.status !== undefined ||
      json.taken !== undefined ||
      json.skipped !== undefined ||
      json.is_taken !== undefined);

  if (isIntakeAction && (!json.medicationName || !json.dosage || !Array.isArray(json.doseTimes))) {
    const result = await recordMedicationIntake(me.clientId, json);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: result.error || 'Failed to record medication intake',
          },
        },
        { status: result.status || 404, headers: PATIENT_CORS }
      );
    }
    return NextResponse.json(
      {
        ...result.data,
        data: result.data,
      },
      { status: 200, headers: PATIENT_CORS }
    );
  }

  const data = createScheduleSchema.parse(json);

  const schedule = await prisma.medicationSchedule.create({
    data: {
      clientId: me.clientId,
      medicationName: data.medicationName,
      dosage: data.dosage,
      instructions: data.instructions,
      doseTimes: data.doseTimes,
      startDate: data.startDate ? new Date(data.startDate) : new Date(),
      endDate: data.endDate ? new Date(data.endDate) : null,
      isActive: true,
    },
  });

  return patientOk({ schedule }, 201, 'Medication schedule created');
});

