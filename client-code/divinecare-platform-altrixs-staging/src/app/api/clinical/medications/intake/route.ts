import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { canWriteClientMedications, clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

const logIntakeSchema = z.object({
  scheduleId: z.string().min(1),
  doseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format'),
  status: z.enum(['taken', 'skipped']),
  clientId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  // Recording a dose taken / skipped edits the medication record: canWriteClientMedications only.
  if (!canWriteClientMedications(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'medicationIntakeLog',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ error: 'Your role cannot record medication doses' }, { status: 403 });
  }

  try {
    const json = await req.json();
    const data = logIntakeSchema.parse(json);

    const access = clientAccessWhere({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });

    const schedule = await prisma.medicationSchedule.findFirst({
      where: {
        id: data.scheduleId,
        clientId: data.clientId,
        client: access,
      },
      select: { id: true, clientId: true },
    });
    if (!schedule) {
      await auditPhiAccess({
        gate, req, action: 'WRITE', resourceType: 'medicationIntakeLog', patientId: data.clientId,
        outcome: 'DENIED', metadata: { scheduleId: data.scheduleId, reason: 'schedule_not_found' },
      });
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
    }

    const [hours, minutes] = data.doseTime.split(':').map(Number);
    const scheduledFor = new Date();
    scheduledFor.setHours(hours!, minutes!, 0, 0);

    const isTaken = data.status === 'taken';

    const log = await prisma.medicationIntakeLog.upsert({
      where: {
        scheduleId_scheduledFor: {
          scheduleId: schedule.id,
          scheduledFor,
        },
      },
      update: {
        takenAt: isTaken ? new Date() : null,
        skipped: !isTaken,
      },
      create: {
        scheduleId: schedule.id,
        clientId: schedule.clientId,
        scheduledFor,
        takenAt: isTaken ? new Date() : null,
        skipped: !isTaken,
      },
    });

    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'medicationIntakeLog', resourceId: log.id,
      patientId: schedule.clientId, metadata: { scheduleId: schedule.id, status: data.status, fields: ['takenAt', 'skipped'] },
    });

    return NextResponse.json({
      success: true,
      log,
      message: isTaken ? 'Dose recorded as taken' : 'Dose recorded as skipped',
    });
  } catch (err) {
    console.error('[Clinical Intake Error]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
