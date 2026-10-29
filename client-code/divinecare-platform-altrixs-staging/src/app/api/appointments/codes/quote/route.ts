import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments, clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { appointmentForCodes, codeContext } from '@/lib/appointments/plannedCodesDb';
import { quoteResponse } from '@/lib/appointments/plannedCodesQuote';

export const runtime = 'nodejs';

const lineSchema = z.object({
  code: z.string().trim().max(12),
  units: z.number().int().min(0).max(999).optional(),
  modifiers: z.array(z.string().trim().max(4)).max(6).optional(),
  isAddOn: z.boolean().optional(),
});

const bodySchema = z.object({
  /** Edit form: the appointment being edited (its check-in location, group and facility are used) */
  appointmentId: z.string().min(1).max(128).optional().nullable(),
  clientId: z.string().min(1).max(128).optional().nullable(),
  clinicianId: z.string().min(1).max(128).optional().nullable(),
  type: z.string().max(120).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  isVirtual: z.boolean().optional(),
  audioOnly: z.boolean().optional(),
  lines: z.array(lineSchema).max(4).default([]),
  withOptions: z.boolean().optional(),
});

/**
 * POST /api/appointments/codes/quote — booking panel "Billing codes": defaults (appointment type
 * or group code, payer telehealth modifier, POS, supervision), fee schedule charges per line
 * ("No fee set" when the fee schedule has none), add-on suggestions and validation. Saves nothing.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClientAppointments(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const actor = { id: gate.userId, role: gate.role as Role, organizationId: gate.organizationId };
  let appt: Awaited<ReturnType<typeof appointmentForCodes>> | null = null;
  if (body.appointmentId) {
    appt = await appointmentForCodes(actor, body.appointmentId);
    if (appt.ok === false) return NextResponse.json({ success: false, error: appt.error }, { status: appt.status });
  }
  const a = appt && appt.ok ? appt.appointment : null;
  const clientId = a?.clientId ?? body.clientId ?? null;
  if (clientId && !a) {
    const ok = await prisma.client.findFirst({
      where: { AND: [{ id: clientId }, clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role })] },
      select: { id: true },
    });
    if (!ok) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }
  const clinicianId = body.clinicianId ?? a?.clinicianId ?? null;
  const { context, items } = await codeContext(gate.organizationId, {
    clientId,
    clinicianId,
    type: body.type ?? a?.type ?? null,
    isVirtual: body.isVirtual ?? a?.isVirtual ?? false,
    audioOnly: body.audioOnly ?? a?.audioOnly ?? false,
    patientLocationType: a?.patientLocationType ?? null,
    serviceDate: body.date ?? a?.startsAt ?? null,
    groupSessionId: a?.groupSessionId ?? null,
    locationId: a?.locationId ?? null,
  });
  if (clientId) {
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'appointmentCodesQuote', resourceId: a?.id ?? clientId, patientId: clientId,
      metadata: { codes: body.lines.map((l) => l.code.toUpperCase()).filter(Boolean) },
    });
  }
  return NextResponse.json(
    quoteResponse(String(gate.role), {
      // A new booking with the clinician set to the actor counts as their own appointment
      isOwnAppointment: (a ? a.clinicianId : clinicianId) === gate.userId,
      context,
      items,
      lines: body.lines.map((l) => ({ ...l, code: l.code })),
      withOptions: Boolean(body.withOptions),
    })
  );
}
