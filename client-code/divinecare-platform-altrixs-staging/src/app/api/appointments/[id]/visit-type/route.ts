import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { changeVisitType, getVisitTypeState } from '@/lib/appointments/visitTypeChangeServer';
import { VISIT_TYPE_REASON_MAX } from '@/lib/appointments/visitTypeChange';

export const runtime = 'nodejs';

/**
 * Visit type during the visit (src/lib/appointments/visitTypeChange.ts).
 * GET: current type, the types this visit can change to, and why it can't (signed / billed).
 * PATCH: change it (type, in person / telehealth, length when it fits). Audited old -> new.
 * Same gate as editing the appointment (PATCH /api/appointments/[id]).
 */

const patchSchema = z.object({
  type: z.string().trim().min(1).max(120),
  isVirtual: z.boolean().optional().nullable(),
  adjustLength: z.boolean().optional(),
  reason: z.string().trim().max(VISIT_TYPE_REASON_MAX).optional().nullable(),
});

async function gateFor() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { fail: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) } as const;
  if (!canAccessClientAppointments(gate.role)) {
    return { fail: NextResponse.json({ success: false, error: 'Not allowed to update appointments' }, { status: 403 }) } as const;
  }
  return { gate } as const;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gateFor();
  if ('fail' in g) return g.fail;
  const { gate } = g;
  const { id } = await ctx.params;
  const result = await getVisitTypeState(id, { id: gate.userId, role: gate.role, organizationId: gate.organizationId });
  if (result.ok === false) {
    if (result.status === 403 || result.status === 404) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'appointment', resourceId: id, outcome: 'DENIED', metadata: { view: 'visit_type', status: result.status } });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, ...result.state });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gateFor();
  if ('fail' in g) return g.fail;
  const { gate } = g;
  const { id } = await ctx.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Choose a visit type' }, { status: 400 });
  }
  try {
    const result = await changeVisitType(id, body, { id: gate.userId, role: gate.role, organizationId: gate.organizationId });
    if (result.ok === false) {
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'appointment', resourceId: id, outcome: 'DENIED', metadata: { change: 'visit_type', status: result.status } });
      }
      return NextResponse.json({ success: false, error: result.error, code: result.code ?? null }, { status: result.status });
    }
    // HIPAA audit: old -> new visit type and setting, who (actor on the row), optional reason
    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'appointment',
      resourceId: id,
      patientId: result.clientId,
      metadata: {
        change: 'visit_type',
        fields: result.changed,
        fromType: result.before.type,
        toType: result.after.type,
        fromVirtual: result.before.isVirtual,
        toVirtual: result.after.isVirtual,
        lengthAdjusted: result.length.adjusted,
        lengthKeptForNextVisit: result.length.collision,
        placeOfService: result.place.placeOfService,
        notesUpdated: result.notesUpdated,
        reason: body.reason?.trim() || null,
      },
    });
    return NextResponse.json({
      success: true,
      type: result.after.type,
      isVirtual: result.after.isVirtual,
      endsAt: result.after.endsAt,
      changed: result.changed,
      lengthMessage: result.length.message,
      lengthAdjusted: result.length.adjusted,
      place: result.place,
      noteType: result.noteType,
      notesUpdated: result.notesUpdated,
    });
  } catch (err) {
    console.error('[visit-type] change failed', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not change the visit type' }, { status: 500 });
  }
}
