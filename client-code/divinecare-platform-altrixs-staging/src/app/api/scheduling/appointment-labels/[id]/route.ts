import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { canManageAppointmentLabels } from '@/lib/scheduling/appointmentLabelAccess';
import { labelUpdateSchema } from '@/lib/scheduling/appointmentLabels';
import { updateLabel } from '@/lib/scheduling/appointmentLabelsServer';

export const runtime = 'nodejs';

/** PATCH — edit display name, color, availability, meaning, active, sort order. Labels are turned off, not deleted. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageAppointmentLabels(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = labelUpdateSchema.parse(await req.json());
    const result = await updateLabel(gate.organizationId, id, gate.userId, body);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    const pick = (o: Record<string, unknown>) => Object.fromEntries(result.changed.map((k) => [k, o[k] ?? null]));
    await writeAuditLog({
      action: 'appointment_label_updated',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'AppointmentLabel',
      resourceId: id,
      metadata: { changed: result.changed, before: pick(result.before), after: pick(result.label) },
    });
    return NextResponse.json({ success: true, label: result.label });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || 'Please check the label'
        : err instanceof Error
          ? err.message
          : 'Could not save label';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
