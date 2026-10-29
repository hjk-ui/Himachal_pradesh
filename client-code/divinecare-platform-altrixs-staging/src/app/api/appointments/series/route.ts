import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { createSeries, previewSeries } from '@/lib/scheduling/series';
import { SERIES_FREQUENCIES } from '@/lib/scheduling/recurrence';

export const runtime = 'nodejs';

const seriesBodySchema = z.object({
  clientId: z.string().min(1).max(128),
  type: z.string().min(1).max(120),
  clinicianId: z.string().min(1).max(128).optional().nullable(),
  isVirtual: z.boolean().optional(),
  audioOnly: z.boolean().optional(),
  videoProvider: z.enum(['zoom', 'google', 'in_app', 'chime']).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  labelId: z.string().min(1).max(64).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  allowOverbook: z.boolean().optional(),
  overbookReason: z.string().max(300).optional().nullable(),
  rule: z.object({
    frequency: z.enum(SERIES_FREQUENCIES),
    interval: z.number().int().min(1).max(4).optional().nullable(),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    count: z.number().int().min(1).max(26).optional().nullable(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    durationMinutes: z.number().int().min(5).max(480),
  }),
  /** true = dates + conflicts only, nothing booked */
  preview: z.boolean().optional(),
});

/** POST /api/appointments/series — book a recurring series (or preview it). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Not allowed to schedule appointments' }, { status: 403 });
  }
  let body: z.infer<typeof seriesBodySchema>;
  try {
    body = seriesBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Please check the repeat settings and try again.' }, { status: 400 });
  }
  const actor = { id: gate.userId, role: gate.role, organizationId: gate.organizationId };
  const input = {
    ...body,
    videoProvider: (body.videoProvider === 'chime' ? 'in_app' : body.videoProvider || undefined) as 'zoom' | 'google' | 'in_app' | undefined,
  };

  if (body.preview) {
    const p = await previewSeries(input, actor);
    if (p.ok === false) return NextResponse.json({ success: false, error: p.error }, { status: p.status });
    return NextResponse.json({ success: true, ...p });
  }

  const r = await createSeries(input, actor);
  if (r.ok === false) {
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'appointment_series', resourceId: null, patientId: body.clientId,
      outcome: r.status === 403 || r.status === 404 ? 'DENIED' : 'FAILURE', metadata: { status: r.status },
    });
    return NextResponse.json({ success: false, error: r.error, skipped: 'skipped' in r ? r.skipped : undefined }, { status: r.status });
  }
  await auditPhiAccess({
    gate, req, action: 'CREATE', resourceType: 'appointment_series', resourceId: r.seriesId, patientId: body.clientId,
    metadata: {
      frequency: body.rule.frequency,
      interval: body.rule.interval ?? 1,
      createdCount: r.created.length,
      skippedCount: r.skipped.length,
      skippedReasons: r.skipped.map((s) => s.reason),
      appointmentIds: r.created.map((c) => c.id),
      overbook: body.allowOverbook ? true : null,
      reason: body.allowOverbook ? body.overbookReason ?? null : null,
    },
  });
  return NextResponse.json({ success: true, seriesId: r.seriesId, created: r.created, skipped: r.skipped, timeZone: r.timeZone }, { status: 201 });
}
