import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { sendToUser } from '@/lib/notifications/pushService';
import { canViewClientMedications, canWriteClientMedications, clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { medicationSourceSchema } from '@/lib/clinical/medicationSource';
import { isAntipsychotic } from '@/app/api/clients/[id]/safety-check/route';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { optionalDrugCode, rxcuiSchema } from '@/lib/drugs/resolve';
import { medicationCodeFields } from '@/lib/drugs/types';

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
  // Medication-list source; when present the med is also recorded on the client's
  // medication list (ClientMedication) for reconciliation ahead of e-prescribing.
  source: medicationSourceSchema.optional(),
  /** RxCUI (specific strength + form) from the drug typeahead; stored on the medication list entry (MUM2-MUM4) */
  rxcui: rxcuiSchema.optional().nullable(),
});

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  // Medication names / dosages: leadership, licensed BH, primary care team, crisis responders
  // (canViewClientMedications). Not Front Desk, Office Manager, Billing, Peer, CM or PRP.
  if (!canViewClientMedications(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'medicationSchedule', patientId: clientId || null,
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ error: 'Your role cannot view medications' }, { status: 403 });
  }

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
      await auditPhiAccess({
        gate, req, action: 'LIST', resourceType: 'medicationSchedule', patientId: clientId,
        outcome: 'DENIED', metadata: { reason: 'patient_not_found' },
      });
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
      fillEvents = (await prisma.$queryRawUnsafe(`
        SELECT prescription_rcopia_id, fill_status, adherence_flag, fill_notes, pharmacy_name, fill_date
        FROM rcopia_rxfill_events
        WHERE client_id = $1
        ORDER BY fill_date DESC
      `, clientId)) as any[];
    } catch {}
  }

  const latestFill = fillEvents.length > 0 ? fillEvents[0] : null;

  // Source per medication from the client's medication list (matched by name).
  const sourceByName = new Map<string, string>();
  if (clientId) {
    const listed = await prisma.clientMedication.findMany({
      where: { clientId, active: true },
      select: { medicationName: true, source: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const m of listed) sourceByName.set(m.medicationName.trim().toLowerCase(), m.source);
  }

  const formatted = schedules.map((sched) => ({
    id: sched.id,
    clientId: sched.clientId,
    patientName: sched.client.name,
    hasMobileApp: sched.client.deviceTokens.length > 0,
    deviceCount: sched.client.deviceTokens.length,
    medicationName: sched.medicationName,
    source: sourceByName.get(sched.medicationName.trim().toLowerCase()) ?? null,
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

  await auditPhiAccess({
    gate, req, action: 'LIST', resourceType: 'medicationSchedule', patientId: clientId || null,
    metadata: { count: formatted.length, clientId: clientId || null, fillEvents: fillEvents.length },
  });
  return NextResponse.json({ success: true, medications: formatted });
}

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  // Add a medication: leadership, licensed BH clinicians, primary care team (canWriteClientMedications).
  if (!canWriteClientMedications(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'medicationSchedule',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ error: 'Your role cannot add medications' }, { status: 403 });
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
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'medicationSchedule', patientId: data.clientId,
        outcome: 'DENIED', metadata: { reason: 'patient_not_found' },
      });
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + data.daysSupply * 24 * 60 * 60 * 1000);
    // Resolved before the transaction: RxNav down -> saved uncoded with a warning
    const drug = data.source ? await optionalDrugCode(data.rxcui, 'medication') : { code: null };
    if ('invalid' in drug && drug.invalid) return NextResponse.json({ error: drug.invalid }, { status: 400 });

    const schedule = await prisma.$transaction(async (tx) => {
      const created = await tx.medicationSchedule.create({
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
      if (data.source) {
        await tx.clientMedication.create({
          data: {
            clientId: client.id,
            medicationName: data.medicationName,
            dosage: data.dosage,
            instructions: data.instructions || null,
            startDate,
            active: true,
            status: 'active',
            source: data.source,
            isAntipsychotic: isAntipsychotic(data.medicationName),
            // Only "Prescribed here" is attributed to the entering clinician.
            prescribedById: data.source === 'prescribed' ? gate.userId : null,
            ...(drug.code ? medicationCodeFields(drug.code) : {}),
          },
        });
      }
      return created;
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
        title: `New Prescription: ${data.medicationName}`,
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

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'medicationSchedule', resourceId: schedule.id, patientId: client.id,
      metadata: {
        fields: Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] != null && k !== 'clientId'),
        addedToMedicationList: Boolean(data.source),
        source: data.source ?? null,
        coded: Boolean(drug.code),
        notified,
      },
    });

    return NextResponse.json({
      success: true,
      schedule,
      notified,
      notifySkipReason,
      notificationResult,
      ...('warning' in drug && drug.warning ? { drugCodeWarning: drug.warning } : {}),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message || 'Invalid medication payload' },
        { status: 400 }
      );
    }
    // Log the error name only — Prisma messages can echo medication / patient values.
    console.error('[Clinical Medication Create Error]:', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ error: 'Could not save medication' }, { status: 500 });
  }
}
