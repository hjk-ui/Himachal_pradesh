import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { loadWorkflowView, scheduleCourse } from '@/lib/tms/workflowDb';

export const runtime = 'nodejs';

const schema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  clinicianId: z.string().min(1).max(128),
  /** From the order / authorization: no default number */
  sessions: z.number().int().min(1).max(200),
  location: z.string().max(200).nullish(),
});

/**
 * POST — "Schedule TMS course": checks consent, screening, authorization, the prescriber
 * determination and the payer rule, then books 5 days a week x 20 minutes for the given number
 * of sessions (appointment series, at most 26 visits each) and assigns the weekly measure.
 */
export async function POST(req: Request, ctx: { params: Promise<{ courseId: string }> }) {
  const g = await tmsGate('write');
  if (g.ok === false) return g.res;
  if (!canAccessClientAppointments(g.gate.role)) {
    return NextResponse.json({ success: false, error: 'Not allowed to schedule appointments' }, { status: 403 });
  }
  const { courseId } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  try {
    const r = await scheduleCourse(g.actor, courseId, parsed.data);
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: 'tmsCourseSchedule',
      resourceId: courseId,
      patientId: r.clientId,
      metadata: { requested: r.requested, booked: r.booked, skippedCount: r.skipped.length, seriesIds: r.seriesIds, measureAssigned: Boolean(r.measureAssignmentId) },
    });
    return NextResponse.json({
      success: true,
      booked: r.booked,
      requested: r.requested,
      skipped: r.skipped,
      measureNote: r.measureNote,
      workflow: await loadWorkflowView(g.actor, courseId),
    });
  } catch (err) {
    return tmsError(err, 'Could not schedule the TMS course');
  }
}
