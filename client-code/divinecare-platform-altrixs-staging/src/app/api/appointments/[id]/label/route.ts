import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { setAppointmentLabel } from '@/lib/appointments/manage';
import { canSetAppointmentLabel } from '@/lib/scheduling/appointmentLabelAccess';
import { appointmentLabelSetSchema } from '@/lib/scheduling/appointmentLabels';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** PUT { labelId: string | null, viaSuggestion?: meaning } — set or clear the calendar label. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canSetAppointmentLabel(gate.role)) {
    return NextResponse.json({ success: false, error: 'Not allowed to update appointments' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = appointmentLabelSetSchema.parse(await req.json());
    const result = await setAppointmentLabel(id, body.labelId, {
      id: gate.userId,
      role: gate.role,
      organizationId: gate.organizationId,
    });
    if (result.ok === false) {
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({
          gate, req, action: 'UPDATE', resourceType: 'appointment_label', resourceId: id,
          outcome: 'DENIED', metadata: { status: result.status },
        });
      }
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'appointment_label',
      resourceId: id,
      patientId: result.appointment.clientId,
      metadata: {
        fromLabelId: result.previousLabelId,
        toLabelId: result.appointment.labelId,
        viaSuggestion: body.viaSuggestion ?? null,
      },
    });
    return NextResponse.json({ success: true, appointment: result.appointment });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid label' : err instanceof Error ? err.message : 'Could not set label';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
