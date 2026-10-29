import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { canReviewLabResults } from '@/lib/labs/access';
import { accessWhere, lockedClientIds } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowGate, zodMessage } from '../../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'labOrder';
const bodySchema = z.object({
  orderId: z.string().trim().min(1).max(128),
  method: z.enum(['phone', 'portal_message', 'letter', 'in_person']),
  notifiedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

/**
 * POST /api/medical/inbasket/notify — close the loop on a reviewed result: record that the patient
 * was told (method + date). Prescribers only, after the provider review; portal release through
 * the Labs page counts on its own.
 */
export async function POST(req: Request) {
  const g = await workflowGate(req, { action: 'UPDATE', resourceType: RESOURCE, allow: canReviewLabResults });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the entry') }, { status: 400 });
  }
  const v = g.viewer;
  const order = await prisma.labOrder.findFirst({
    where: { id: body.orderId, organizationId: v.organizationId, client: accessWhere(v) },
    select: { id: true, clientId: true, reviewedAt: true, resultedAt: true, patientNotifiedAt: true, releasedAt: true },
  });
  const locked = order ? await lockedClientIds(v, [order.clientId]) : null;
  if (!order || locked === null || locked.has(order.clientId)) return NextResponse.json({ success: false, error: 'Lab order not found' }, { status: 404 });
  if (!order.reviewedAt) return NextResponse.json({ success: false, error: 'Review and sign off the result first' }, { status: 409 });
  if (order.patientNotifiedAt) return NextResponse.json({ success: false, error: 'Patient notification is already recorded' }, { status: 409 });
  const timeZone = await getPracticeTimeZone(v.organizationId);
  const today = toPracticeWallTime(new Date(), timeZone).date;
  if (body.notifiedOn > today) return NextResponse.json({ success: false, error: 'The date cannot be in the future' }, { status: 400 });
  try {
    const me = await prisma.user.findUnique({ where: { id: v.userId }, select: { name: true, email: true } });
    await prisma.labOrder.update({
      where: { id: order.id },
      data: {
        patientNotifiedAt: new Date(`${body.notifiedOn}T12:00:00Z`),
        patientNotifiedMethod: body.method,
        patientNotifiedById: v.userId,
        patientNotifiedByName: me?.name?.trim() || me?.email || null,
      },
    });
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: RESOURCE, resourceId: order.id, patientId: order.clientId, metadata: { event: 'patient_notified', method: body.method } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[medical/inbasket/notify POST]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not record the notification' }, { status: 500 });
  }
}
