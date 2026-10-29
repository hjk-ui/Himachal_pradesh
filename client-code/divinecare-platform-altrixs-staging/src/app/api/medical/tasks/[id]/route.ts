import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canRoomPatients, isMedicalAssistant } from '@/lib/medical/primaryCareWorkflow';
import { accessWhere } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowGate, zodMessage } from '../../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalTask';
const patchSchema = z.object({ status: z.enum(['done', 'cancelled']) });

/** PATCH /api/medical/tasks/[id] — MA marks a routed task done; the creating provider can cancel it */
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
  const v = g.viewer;
  const row = await prisma.medicalTask.findFirst({ where: { id, organizationId: v.organizationId } });
  if (!row) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
  if (row.status !== 'open') return NextResponse.json({ success: false, error: 'This task is already closed' }, { status: 409 });

  let allowed = row.createdById === v.userId;
  if (!allowed && isMedicalAssistant(v.role) && body.status === 'done') {
    if (row.assignedToId === v.userId) allowed = true;
    else if (!row.assignedToId) {
      allowed = !row.clientId || Boolean(await prisma.client.findFirst({ where: { AND: [accessWhere(v), { id: row.clientId }] }, select: { id: true } }));
    }
  }
  if (!allowed) {
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: RESOURCE, resourceId: row.id, patientId: row.clientId, outcome: 'DENIED', metadata: { reason: 'not_assignee' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    await prisma.medicalTask.update({ where: { id: row.id }, data: { status: body.status, completedById: v.userId, completedAt: new Date() } });
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: RESOURCE, resourceId: row.id, patientId: row.clientId, metadata: { status: body.status } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[medical/tasks PATCH]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not update the task' }, { status: 500 });
  }
}
