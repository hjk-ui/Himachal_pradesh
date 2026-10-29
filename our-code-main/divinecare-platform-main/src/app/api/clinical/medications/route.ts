import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { sendToUser } from '@/lib/notifications/pushService';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { Prisma } from '@prisma/client';

const createMedicationSchema = z.object({
  clientId: z.string().min(1),
  medicationName: z.string().trim().min(1),
  dosage: z.string().trim().min(1),
  instructions: z.string().trim().optional(),
  doseTimes: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'))
    .min(1),
  daysSupply: z.number().int().positive().optional().default(30),
  notifyPatient: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  const access = clientAccessWhere({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  if (clientId) {
    const allowed = await prisma.client.findFirst({
      where: { AND: [clientByIdWhere(clientId, gate.organizationId), access] },
      select: { id: true },
    });
    if (!allowed) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const schedules = await prisma.medicationSchedule.findMany({
    where: {
      isActive: true,
      client: access,
      ...(clientId ? { clientId } : {}),
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          deviceTokens: {
            select: { id: true, platform: true, lastUsedAt: true },
          },
        },
      },
      intakeLogs: {
        where: {
          scheduledFor: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  let fillEvents: any[] = [];
  if (clientId) {
    try {
      fillEvents = (await prisma.$queryRaw(Prisma.sql`
        SELECT prescription_rcopia_id, fill_status, adherence_flag, fill_notes, pharmacy_name, fill_date
        FROM rcopia_rxfill_events
        WHERE client_id = ${clientId}
        ORDER BY fill_date DESC
      `)) as any[];
    } catch {}
  }

  const latestFill = fillEvents.length > 0 ? fillEvents[0] : null;

  const formatted = schedules.map((sched) => ({
    id: sched.id,
    clientId: sched.clientId,
    patientName: sched.client.name,
    hasMobileApp: sched.client.deviceTokens.length > 0,
    deviceCount: sched.client.deviceTokens.length,
    medicationName: sched.medicationName,
    dosage: sched.dosage,
    instructions: sched.instructions,
    doseTimes: sched.doseTimes,
    startDate: sched.startDate.toISOString(),
    endDate: sched.endDate ? sched.endDate.toISOString() : null,
    adherenceStatus: latestFill?.fill_status || 'dispensed',
    adherenceFlag: latestFill?.adherence_flag || 'ok',
    pharmacyFillNotes: latestFill?.fill_notes || null,
    pharmacyName: latestFill?.pharmacy_name || null,
    todayDoses: sched.doseTimes.map((timeStr) => {
      const log = sched.intakeLogs.find((l) => {
        const d = new Date(l.scheduledFor);
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${mins}` === timeStr;
      });
      return {
        time: timeStr,
        taken: !!log?.takenAt,
        takenAt: log?.takenAt ? log.takenAt.toISOString() : null,
        skipped: !!log?.skipped,
      };
    }),
  }));

  return NextResponse.json({ success: true, medications: formatted });
}

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const json = await req.json();
    const data = createMedicationSchema.parse(json);

    const access = clientAccessWhere({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });

    // Never resolve by name — id + org/caseload only (blocks cross-clinic IDOR)
    const client = await prisma.client.findFirst({
      where: {
        AND: [clientByIdWhere(data.clientId, gate.organizationId), access],
      },
      include: { deviceTokens: true },
    });

    if (!client) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + data.daysSupply * 24 * 60 * 60 * 1000);

    const schedule = await prisma.medicationSchedule.create({
      data: {
        clientId: client.id,
        medicationName: data.medicationName,
        dosage: data.dosage,
        instructions: data.instructions,
        doseTimes: data.doseTimes,
        startDate,
        endDate,
        isActive: true,
      },
    });

    let notificationResult = null;
    let notifySkipReason: string | null = null;

    if (!data.notifyPatient) {
      notifySkipReason = 'notifyPatient was false';
    } else if (client.deviceTokens.length === 0) {
      notifySkipReason =
        'Patient has no registered device token — open the Flutter app while logged in so FCM can register';
    } else {
      notificationResult = await sendToUser(client.id, {
        type: 'medication_reminder',
        title: `💊 New Prescription: ${data.medicationName}`,
        body: `Your doctor prescribed ${data.medicationName} (${data.dosage}). Timings: ${data.doseTimes.join(', ')}.`,
        dedupeKey: `med-create:${schedule.id}`,
        data: {
          medicationScheduleId: schedule.id,
          medicationName: data.medicationName,
          dosage: data.dosage,
          doseTimes: data.doseTimes.join(','),
          route: '/medications',
        },
      });
      if (notificationResult.isMock) {
        notifySkipReason =
          'Firebase is in mock mode on this server — set FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY)';
      } else if (!notificationResult.sentCount) {
        notifySkipReason = notificationResult.error || 'Push not delivered';
      }
    }

    const notified = Boolean(
      notificationResult && notificationResult.sentCount > 0 && !notificationResult.isMock
    );

    return NextResponse.json({
      success: true,
      schedule,
      notified,
      notifySkipReason,
      notificationResult,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid medication payload' },
        { status: 400 }
      );
    }
    console.error('[Clinical Medication Create Error]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
