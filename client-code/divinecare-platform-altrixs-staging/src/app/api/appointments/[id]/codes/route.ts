import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { appointmentForCodes, codeContext, loadPlannedPlan, priceLines, savePlannedPlan, type CodesAppointment } from '@/lib/appointments/plannedCodesDb';
import { quoteResponse } from '@/lib/appointments/plannedCodesQuote';
import { EMPTY_PLAN, preparePlanForSave } from '@/lib/appointments/plannedCodes';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

async function gateFor(id: string) {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!canAccessClientAppointments(gate.role)) {
    return { ok: false as const, res: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  const actor = { id: gate.userId, role: gate.role as Role, organizationId: gate.organizationId };
  const appt = await appointmentForCodes(actor, id);
  if (appt.ok === false) return { ok: false as const, res: NextResponse.json({ success: false, error: appt.error }, { status: appt.status }) };
  return { ok: true as const, gate, appointment: appt.appointment };
}

function contextInput(x: CodesAppointment) {
  return {
    clientId: x.clientId,
    clinicianId: x.clinicianId,
    type: x.type,
    isVirtual: x.isVirtual,
    audioOnly: x.audioOnly,
    patientLocationType: x.patientLocationType,
    serviceDate: x.startsAt,
    groupSessionId: x.groupSessionId,
    locationId: x.locationId,
  };
}

/** GET /api/appointments/[id]/codes — the saved plan (planned codes; the signed note's codes bill) + defaults. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await gateFor(id);
  if (g.ok === false) return g.res;
  const plan = (await loadPlannedPlan(g.gate.organizationId, id)) ?? EMPTY_PLAN;
  const { context, items } = await codeContext(g.gate.organizationId, contextInput(g.appointment));
  await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'appointmentPlannedCodes', resourceId: id, patientId: g.appointment.clientId });
  return NextResponse.json({
    ...quoteResponse(String(g.gate.role), {
      isOwnAppointment: g.appointment.clinicianId === g.gate.userId,
      context,
      items,
      lines: plan.lines,
      withOptions: new URL(req.url).searchParams.get('options') === '1',
    }),
    plan,
  });
}

const lineSchema = z.object({
  code: z.string().trim().max(12),
  units: z.number().int().min(0).max(999).optional(),
  modifiers: z.array(z.string().trim().max(4)).max(6).optional(),
  chargeCents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  overrideReason: z.string().max(300).optional().nullable(),
  isAddOn: z.boolean().optional(),
});

const putSchema = z.object({
  lines: z.array(lineSchema).max(4),
  placeOfService: z.string().trim().max(2).optional().nullable(),
  supervisingProviderId: z.string().max(128).optional().nullable(),
  discountCents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  discountNote: z.string().max(500).optional().nullable(),
});

/**
 * PUT /api/appointments/[id]/codes — save planned codes. Front desk, office manager, billing and
 * leadership on any appointment they can open; clinicians on their own. Charges are recomputed
 * from the fee schedule (billing roles may override with a reason); courtesy discount is billing /
 * front desk / office manager only. Audited with field names and codes only.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await gateFor(id);
  if (g.ok === false) return g.res;
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Please check the billing codes and try again.' }, { status: 400 });
  }
  const [existing, { context, items }] = await Promise.all([
    loadPlannedPlan(g.gate.organizationId, id),
    codeContext(g.gate.organizationId, contextInput(g.appointment)),
  ]);
  const fees = priceLines(items, context.visit, body.lines).map((p) => p.chargeCents);
  const prepared = preparePlanForSave(body, {
    role: g.gate.role,
    isOwnAppointment: g.appointment.clinicianId === g.gate.userId,
    feeCharges: fees,
    existing,
  });
  if (prepared.ok === false) {
    if (prepared.status === 403) {
      await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'appointmentPlannedCodes', resourceId: id, patientId: g.appointment.clientId, outcome: 'DENIED' });
    }
    return NextResponse.json({ success: false, error: prepared.error }, { status: prepared.status });
  }
  if (!prepared.changedFields.length) return NextResponse.json({ success: true, plan: prepared.plan, changed: false });
  try {
    await savePlannedPlan(g.gate.organizationId, id, g.gate.userId, prepared.plan);
  } catch (err) {
    console.error('[appointment codes] save failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Billing codes could not be saved (the planned-codes tables may not be migrated yet).' }, { status: 503 });
  }
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'UPDATE',
    resourceType: 'appointmentPlannedCodes',
    resourceId: id,
    patientId: g.appointment.clientId,
    // Field names and codes only (no amounts, notes or reasons)
    metadata: {
      fields: prepared.changedFields,
      codes: prepared.plan.lines.map((l) => [l.code, ...l.modifiers].join('-')),
      previousCodes: (existing ?? EMPTY_PLAN).lines.map((l) => [l.code, ...l.modifiers].join('-')),
    },
  });
  return NextResponse.json({ success: true, plan: prepared.plan, changed: true });
}
