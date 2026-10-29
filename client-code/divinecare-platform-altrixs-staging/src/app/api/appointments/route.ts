import { NextResponse } from 'next/server';
import { schedulingLicenseBlock } from '@/lib/hr/expirations';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { APPOINTMENT_TYPES } from '@/features/appointments';
import {
  createAppointment,
  listAppointmentsForUser,
} from '@/lib/appointments/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { DUPLICATE_APPOINTMENT_CODE } from '@/lib/appointments/duplicates';
import { CLINICIAN_OVERLAP_CODE } from '@/lib/appointments/overlap';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { appointmentListWindow } from '@/lib/appointments/listWindow';
import { withFilterFacets } from '@/lib/appointments/listFacets';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  type: z.string().min(1).max(120),
  /** UTC instant (ISO with Z / offset). Naive values are read as practice time and logged. */
  startsAt: z.string().min(16).max(40).optional().nullable(),
  endsAt: z.string().min(16).max(40).optional().nullable(),
  /** Legacy: practice wall-clock date + time (used when startsAt is absent). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .nullable(),
  isVirtual: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  clinicianId: z.string().min(1).max(128).optional().nullable(),
  videoProvider: z.enum(['zoom', 'google', 'in_app', 'chime']).optional().nullable(),
  labelId: z.string().min(1).max(64).optional().nullable(),
  /** Book even if this client + clinician + start already has a live appointment (no UI sends this). */
  allowDuplicate: z.boolean().optional(),
  /** Intentional overbook over another appointment of the same clinician (reason required, audited). */
  allowOverbook: z.boolean().optional(),
  overbookReason: z.string().max(300).optional().nullable(),
  /** Telehealth by phone only */
  audioOnly: z.boolean().optional(),
}).refine((b) => Boolean(b.startsAt) || (Boolean(b.date) && Boolean(b.startTime)), {
  message: 'startsAt (or date + startTime) is required',
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view appointments' },
      { status: 403 }
    );
  }

  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId') || undefined;
    const isVirtual = url.searchParams.get('isVirtual') === 'true';
    const date = url.searchParams.get('date') || undefined;
    // Practice-calendar window: from / to (YYYY-MM-DD), default 90 days back .. 365 ahead;
    // clientId with no dates = full chart history.
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    const win = appointmentListWindow({ date, from, to, clientId }, timeZone);
    if (win.ok === false) {
      return NextResponse.json({ success: false, error: win.error }, { status: 400 });
    }
    // facets=1 (scheduler filters): site, MRN, payer and "new client" on rows already in scope.
    // Never adds rows; role / caseload scoping above is unchanged.
    const facets = url.searchParams.get('facets') === '1';
    const listed = await listAppointmentsForUser(
      {
        id: gate.userId,
        role: gate.role,
        organizationId: gate.organizationId,
      },
      { clientId, isVirtual: isVirtual || undefined, date, from, to }
    );
    const appointments = facets ? await withFilterFacets(listed, { organizationId: gate.organizationId, role: gate.role }) : listed;
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'appointment',
      resourceId: clientId ?? null,
      patientId: clientId ?? null,
      metadata: {
        count: appointments.length,
        filters: { clientId: clientId ?? null, isVirtual: isVirtual || null, hasDateFilter: Boolean(date), from: win.window?.from ?? null, to: win.window?.to ?? null, facets: facets || null },
        appointmentIds: appointments.slice(0, 50).map((a) => a.id),
      },
    });
    return NextResponse.json({
      success: true,
      appointments,
      timeZone,
      range: win.window ? { from: win.window.from, to: win.window.to } : null,
    });
  } catch (err) {
    console.error('[appointments GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load appointments' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to schedule appointments' },
      { status: 403 }
    );
  }

  try {
    const body = createSchema.parse(await req.json());
    // Prefer known catalog types; still allow seeded specialty labels
    if (
      !(APPOINTMENT_TYPES as readonly string[]).includes(body.type) &&
      body.type.trim().length < 2
    ) {
      return NextResponse.json({ success: false, error: 'Invalid appointment type' }, { status: 400 });
    }

    // HR setting "Block scheduling when license expired" (default OFF): only then refuse.
    const licenseBlock = await schedulingLicenseBlock(gate.organizationId, body.clinicianId ?? null);
    if (licenseBlock.blocked) {
      return NextResponse.json({ success: false, error: licenseBlock.message, code: 'LICENSE_EXPIRED' }, { status: 409 });
    }

    const mappedProvider =
      body.videoProvider === 'chime' ? 'in_app' : body.videoProvider;

    const result = await createAppointment(
      {
        ...body,
        videoProvider: (mappedProvider || undefined) as 'zoom' | 'google' | 'in_app' | undefined,
      },
      gate.userId,
      gate.organizationId,
      gate.role
    );
    if (result.ok === false) {
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'appointment', resourceId: body.clientId, patientId: body.clientId, outcome: 'DENIED', metadata: { status: result.status } });
      }
      if ('code' in result && result.code === DUPLICATE_APPOINTMENT_CODE) {
        // Not booked: the slot is already held. Hand back the existing id so the UI can open it.
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'appointment', resourceId: result.existingId, patientId: body.clientId, outcome: 'DENIED', metadata: { status: 409, reason: 'duplicate', existingAppointmentId: result.existingId } });
        return NextResponse.json(
          { success: false, error: result.error, code: result.code, existingAppointmentId: result.existingId },
          { status: 409 }
        );
      }
      if ('code' in result && result.code === CLINICIAN_OVERLAP_CODE) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'appointment', resourceId: result.existingId, patientId: body.clientId, outcome: 'DENIED', metadata: { status: 409, reason: 'clinician_overlap', conflictIds: result.conflictIds } });
        return NextResponse.json(
          { success: false, error: result.error, code: result.code, conflictIds: result.conflictIds, existingAppointmentId: result.existingId },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    if (result.overbookReason) {
      // Intentional overbook: who, which visit, and why (the reason is staff text, not PHI by design).
      await auditPhiAccess({
        gate,
        req,
        action: 'APPOINTMENT_OVERBOOK',
        resourceType: 'appointment',
        resourceId: result.appointment.id,
        patientId: body.clientId,
        metadata: { overbook: true, reason: result.overbookReason, clinicianId: result.appointment.clinicianId },
      });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'appointment',
      resourceId: result.appointment.id,
      patientId: body.clientId,
      metadata: {
        fields: Object.keys(body).filter((k) => body[k as keyof typeof body] != null),
        isVirtual: body.isVirtual ?? null,
        videoProvider: mappedProvider ?? null,
        labelId: result.appointment.labelId ?? null,
        labelSource: result.labelApplied === 'chosen' ? 'chosen' : result.labelApplied ? `auto:${result.labelApplied}` : null,
        allowDuplicate: body.allowDuplicate ? true : null,
        // Stored instant + zone it was read in, so a future time-zone repair can check the input.
        startsAt: result.appointment.startsAt,
        timeZone: result.appointment.timeZone,
        timeInput: body.startsAt ? 'instant' : 'practice_wall_clock',
      },
    });
    return NextResponse.json(
      // Confirmation text outcome (consent-gated): sent, or "Not sent: ..." with the reason
      { success: true, appointment: result.appointment, sms: result.sms },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Please check the appointment form and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not create appointment';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
