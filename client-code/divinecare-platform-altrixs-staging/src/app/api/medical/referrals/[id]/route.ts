import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canRoomPatients, isPrimaryCareProvider, referralNextStatuses } from '@/lib/medical/primaryCareWorkflow';
import { workflowClientGate, workflowGate, zodMessage } from '../../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalReferral';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const patchSchema = z.object({
  status: z.enum(['scheduled', 'seen', 'report_received', 'cancelled']),
  date: z.string().trim().regex(YMD, 'Use YYYY-MM-DD').optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * PATCH /api/medical/referrals/[id] — move a referral along (sent → scheduled → seen → report
 * received; or cancelled). Primary care team (physician, medical NP, MA). A behavioral health warm
 * handoff can only be cancelled here (by a provider): its scheduled / seen status comes from the
 * schedule, and nothing from the BH visit is shared back.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await workflowGate(req, { action: 'UPDATE', resourceType: RESOURCE, allow: canRoomPatients });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the update') }, { status: 400 });
  }
  const row = await prisma.medicalReferral.findFirst({ where: { id, organizationId: g.viewer.organizationId } });
  if (!row) return NextResponse.json({ success: false, error: 'Referral not found' }, { status: 404 });
  const c = await workflowClientGate(req, g.gate, g.viewer, row.clientId, { action: 'UPDATE', resourceType: RESOURCE });
  if (c.ok === false) return c.response;

  if (row.kind === 'internal_bh') {
    if (body.status !== 'cancelled' || !isPrimaryCareProvider(g.viewer.role)) {
      return NextResponse.json({ success: false, error: 'A behavioral health handoff updates from the schedule; a provider can cancel it.' }, { status: 409 });
    }
  }
  if (!referralNextStatuses(row.kind, row.status).includes(body.status)) {
    return NextResponse.json({ success: false, error: `A ${row.status.replace('_', ' ')} referral cannot move to ${body.status.replace('_', ' ')}` }, { status: 409 });
  }
  const date = body.date ? new Date(`${body.date}T12:00:00Z`) : null;
  if ((body.status === 'scheduled' || body.status === 'seen') && !date) {
    return NextResponse.json({ success: false, error: body.status === 'scheduled' ? 'Enter the appointment date' : 'Enter the date the patient was seen' }, { status: 400 });
  }
  try {
    const updated = await prisma.medicalReferral.update({
      where: { id: row.id },
      data: {
        status: body.status,
        statusNote: row.kind === 'internal_bh' ? null : body.note || row.statusNote,
        ...(body.status === 'scheduled' ? { scheduledFor: date } : {}),
        ...(body.status === 'seen' ? { seenAt: date } : {}),
        ...(body.status === 'report_received' ? { reportReceivedAt: date ?? new Date() } : {}),
        updatedById: g.viewer.userId,
      },
    });
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: RESOURCE, resourceId: row.id, patientId: row.clientId, metadata: { from: row.status, to: updated.status, kind: row.kind } });
    return NextResponse.json({ success: true, status: updated.status });
  } catch (err) {
    console.error('[medical/referrals PATCH]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not update the referral' }, { status: 500 });
  }
}
