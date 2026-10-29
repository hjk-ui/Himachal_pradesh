import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  ROOMING_ROLES,
  getRooming,
  upsertRooming,
  openVisitSetsInRoom,
  emptyRooming,
  computeVitalFlags,
  computeBmi,
  needsBpRecheck,
  scheduleChip,
  PHARMACY_CHANGED_COPY,
} from '@/lib/medical/rooming';
import { listStandingOrders, approvedStandingOrdersOnly } from '@/lib/medical/standing-orders';
import {
  assertMedicalAppointmentAccess,
  assertMedicalClientAccess,
} from '@/lib/medical/access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ appointmentId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROOMING_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { appointmentId } = await ctx.params;
  const url = new URL(_req.url);
  const clientIdParam = url.searchParams.get('clientId') || '';
  const openVisit = url.searchParams.get('openVisit') === '1';

  const actor = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  const apptAccess = await assertMedicalAppointmentAccess(actor, appointmentId);
  if (apptAccess.ok === false) {
    // Allow empty draft preview only when clientId provided and in care team (appointment may be new)
    if (!clientIdParam) {
      return NextResponse.json({ success: false, error: apptAccess.error }, { status: apptAccess.status });
    }
    const clientAccess = await assertMedicalClientAccess(actor, clientIdParam);
    if (clientAccess.ok === false) {
      return NextResponse.json(
        { success: false, error: clientAccess.error },
        { status: clientAccess.status }
      );
    }
  }

  const clientId = apptAccess.ok ? apptAccess.clientId : clientIdParam;

  let record = await getRooming(gate.organizationId, appointmentId);
  if (openVisit && record?.status === 'ready') {
    record = await openVisitSetsInRoom(gate.organizationId, appointmentId, gate.userId);
  }
  if (!record && clientId) {
    record = emptyRooming(appointmentId, clientId);
  }

  const orders = await listStandingOrders(gate.organizationId);
  const approvedPoc = approvedStandingOrdersOnly(orders);

  return NextResponse.json({
    success: true,
    rooming: record,
    flags: record ? computeVitalFlags(record) : [],
    bmi: record ? computeBmi(record.vitals.heightIn, record.vitals.weightLb) : null,
    needsBpRecheck: record ? needsBpRecheck(record.vitals) : false,
    scheduleChip: record ? scheduleChip(record) : 'Rooming in progress',
    pharmacyChangedCopy: PHARMACY_CHANGED_COPY,
    approvedPoc,
  });
}

const vitalsSchema = z
  .object({
    systolic: z.number().nullable().optional(),
    diastolic: z.number().nullable().optional(),
    hr: z.number().nullable().optional(),
    rr: z.number().nullable().optional(),
    tempF: z.number().nullable().optional(),
    spo2: z.number().nullable().optional(),
    heightIn: z.number().nullable().optional(),
    weightLb: z.number().nullable().optional(),
    pain: z.number().min(0).max(10).nullable().optional(),
    bpRecheckSystolic: z.number().nullable().optional(),
    bpRecheckDiastolic: z.number().nullable().optional(),
    bpRecheckAt: z.string().nullable().optional(),
  })
  .optional();

const putSchema = z.object({
  clientId: z.string().min(1),
  transition: z.enum(['save', 'ready', 'in_room']).optional(),
  identityConfirmed: z.boolean().optional(),
  chiefComplaint: z.string().max(2000).optional(),
  vitals: vitalsSchema,
  allergyReviewed: z.boolean().optional(),
  medicationReviewed: z.boolean().optional(),
  patientReportedMeds: z.string().max(4000).optional(),
  pharmacyReview: z.enum(['unchanged', 'changed']).nullable().optional(),
  screenings: z
    .object({
      depression: z.enum(['due', 'done', 'not_applicable', 'deferred']).optional(),
      tobacco: z.enum(['due', 'done', 'not_applicable', 'deferred']).optional(),
      alcohol: z.enum(['due', 'done', 'not_applicable', 'deferred']).optional(),
      falls: z.enum(['due', 'done', 'not_applicable', 'deferred']).optional(),
      sdoh: z.enum(['due', 'done', 'not_applicable', 'deferred']).optional(),
      phq9Item9: z.number().min(0).max(3).nullable().optional(),
    })
    .optional(),
  careGapActions: z
    .array(
      z.object({
        gapId: z.string(),
        action: z.enum(['reported_elsewhere', 'outreach']),
        note: z.string().max(500).optional(),
      })
    )
    .optional(),
  pocOrderIds: z.array(z.string()).optional(),
});

export async function PUT(req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROOMING_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { appointmentId } = await ctx.params;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid rooming payload' }, { status: 400 });
  }

  const actor = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  const access = await assertMedicalClientAccess(actor, parsed.data.clientId);
  if (access.ok === false) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  // Ensure appointment exists and belongs to this client/org before FK write
  const appt = await assertMedicalAppointmentAccess(actor, appointmentId);
  if (appt.ok === false) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Appointment not found in care team. Rooming requires a real appointment ID for this patient.',
      },
      { status: 404 }
    );
  }
  if (appt.clientId !== parsed.data.clientId) {
    return NextResponse.json(
      { success: false, error: 'Appointment does not belong to this patient' },
      { status: 400 }
    );
  }

  const { clientId, transition, careGapActions, ...patch } = parsed.data;
  const rooming = await upsertRooming(
    gate.organizationId,
    appointmentId,
    clientId,
    {
      ...patch,
      careGapActions: careGapActions
        ? careGapActions.map((a) => ({
            gapId: a.gapId,
            action: a.action,
            note: a.note || '',
            at: new Date().toISOString(),
          }))
        : undefined,
    },
    gate.userId,
    transition || 'save'
  );

  return NextResponse.json({
    success: true,
    rooming,
    flags: computeVitalFlags(rooming),
    bmi: computeBmi(rooming.vitals.heightIn, rooming.vitals.weightLb),
    needsBpRecheck: needsBpRecheck(rooming.vitals),
    scheduleChip: scheduleChip(rooming),
    pharmacyChangedCopy: PHARMACY_CHANGED_COPY,
  });
}
