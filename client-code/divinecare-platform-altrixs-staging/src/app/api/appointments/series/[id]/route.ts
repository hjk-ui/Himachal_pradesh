import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { cancelSeries, editSeries } from '@/lib/scheduling/series';
import { suggestWaitlistForCancelled } from '@/lib/scheduling/waitlistSuggest';

export const runtime = 'nodejs';

const editSchema = z.object({
  action: z.literal('edit'),
  appointmentId: z.string().min(1).max(128),
  /** "this occurrence" edits go through PATCH /api/appointments/[id] */
  scope: z.enum(['following', 'all']),
  changes: z.object({
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    durationMinutes: z.number().int().min(5).max(480).optional().nullable(),
    clinicianId: z.string().min(1).max(128).optional().nullable(),
    type: z.string().min(1).max(120).optional().nullable(),
    isVirtual: z.boolean().optional().nullable(),
    audioOnly: z.boolean().optional().nullable(),
    allowOverbook: z.boolean().optional(),
    overbookReason: z.string().max(300).optional().nullable(),
  }),
});

const cancelSchema = z.object({
  action: z.literal('cancel'),
  appointmentId: z.string().min(1).max(128),
  scope: z.enum(['this', 'following', 'all']),
});

const bodySchema = z.discriminatedUnion('action', [editSchema, cancelSchema]);

/** PATCH /api/appointments/series/[id] — edit or cancel "this and following" / "entire series". */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Not allowed to update appointments' }, { status: 403 });
  }
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const actor = { id: gate.userId, role: gate.role, organizationId: gate.organizationId };

  if (body.action === 'edit') {
    const r = await editSeries(id, body.appointmentId, body.scope, body.changes, actor);
    if (r.ok === false) {
      if (r.status === 403 || r.status === 404) {
        await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'appointment_series', resourceId: id, outcome: 'DENIED', metadata: { status: r.status } });
      }
      return NextResponse.json({ success: false, error: r.error }, { status: r.status });
    }
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'appointment_series', resourceId: r.seriesId,
      metadata: {
        scope: body.scope,
        fields: Object.keys(body.changes).filter((k) => (body.changes as Record<string, unknown>)[k] != null),
        updatedIds: r.updated,
        unchangedCount: r.unchanged.length,
        overbook: body.changes.allowOverbook ? true : null,
        reason: body.changes.allowOverbook ? body.changes.overbookReason ?? null : null,
      },
    });
    return NextResponse.json({ success: true, ...r });
  }

  const r = await cancelSeries(id, body.appointmentId, body.scope, actor);
  if (r.ok === false) {
    if (r.status === 403 || r.status === 404) {
      await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'appointment_series', resourceId: id, outcome: 'DENIED', metadata: { status: r.status } });
    }
    return NextResponse.json({ success: false, error: r.error }, { status: r.status });
  }
  await auditPhiAccess({
    gate, req, action: 'CANCEL', resourceType: 'appointment_series', resourceId: id,
    metadata: { scope: body.scope, cancelledIds: r.cancelled, failedCount: r.failed.length },
  });
  // Suggestion only: waitlist entries that could take the freed time (nothing is booked or sent).
  const waitlist = await suggestWaitlistForCancelled(gate.organizationId, r.cancelled.slice(0, 1)).catch(() => []);
  return NextResponse.json({ success: true, ...r, waitlistSuggestions: waitlist });
}
