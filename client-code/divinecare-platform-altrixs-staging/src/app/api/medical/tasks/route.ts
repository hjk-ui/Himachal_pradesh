import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canRoomPatients, isMedicalAssistant, isPrimaryCareProvider } from '@/lib/medical/primaryCareWorkflow';
import { accessWhere, lockedClientIds } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowClientGate, workflowGate, zodMessage } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalTask';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const postSchema = z.object({
  clientId: z.string().trim().min(1).max(64).optional().nullable(),
  title: z.string().trim().min(3, 'Enter what needs to be done').max(160),
  detail: z.string().trim().max(1000).optional().nullable(),
  assignedToId: z.string().trim().max(64).optional().nullable(),
  dueOn: z.string().trim().regex(YMD).optional().nullable(),
});

/**
 * GET /api/medical/tasks — Medical Assistant: open tasks assigned to them, or to any MA for a
 * patient they can open. Physician / medical NP: open tasks they created. `?assignees=1` adds the
 * practice's active Medical Assistants (names only) for the routing picker.
 */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'LIST', resourceType: RESOURCE, allow: canRoomPatients });
  if (g.ok === false) return g.response;
  const v = g.viewer;
  try {
    const access = accessWhere(v);
    const accessibleClientIds = async (ids: string[]) => {
      if (!ids.length) return new Set<string>();
      const rows = await prisma.client.findMany({ where: { AND: [access, { id: { in: ids } }] }, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    };
    const where: Prisma.MedicalTaskWhereInput = isMedicalAssistant(v.role)
      ? { organizationId: v.organizationId, status: 'open', OR: [{ assignedToId: v.userId }, { assignedToId: null }] }
      : { organizationId: v.organizationId, status: 'open', createdById: v.userId };
    const rows = await prisma.medicalTask.findMany({ where, orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }], take: 200 });
    const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)))];
    const [allowed, locked, clients] = await Promise.all([
      accessibleClientIds(clientIds),
      lockedClientIds(v, clientIds),
      prisma.client.findMany({ where: { id: { in: clientIds }, organizationId: v.organizationId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(clients.map((c) => [c.id, c.name]));
    const visible = rows.filter((r) => !r.clientId || r.assignedToId === v.userId || r.createdById === v.userId || allowed.has(r.clientId));
    const tasks = visible.map((r) => {
      const masked = Boolean(r.clientId) && (locked === null || locked.has(r.clientId!));
      return {
        id: r.id,
        clientId: masked ? null : r.clientId,
        patient: r.clientId ? (masked ? 'Protected record' : names.get(r.clientId) ?? 'Patient') : null,
        title: masked ? 'Task for a protected record' : r.title,
        detail: masked ? null : r.detail,
        assignedToId: r.assignedToId,
        dueOn: r.dueOn ? r.dueOn.toISOString().slice(0, 10) : null,
        createdByName: r.createdByName,
        createdAt: r.createdAt.toISOString(),
      };
    });
    const assignees = new URL(req.url).searchParams.get('assignees') === '1' && isPrimaryCareProvider(v.role)
      ? await prisma.user.findMany({
          where: { organizationId: v.organizationId, status: 'ACTIVE', OR: [{ role: 'MEDICAL_ASSISTANT' }, { roles: { has: 'MEDICAL_ASSISTANT' } }] },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 100,
        })
      : undefined;
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: RESOURCE, metadata: { count: tasks.length } });
    return NextResponse.json({ success: true, tasks, assignees });
  } catch (err) {
    console.error('[medical/tasks GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load tasks' }, { status: 500 });
  }
}

/** POST /api/medical/tasks — physician / medical NP routes a task to the Medical Assistants (or one MA) */
export async function POST(req: Request) {
  const g = await workflowGate(req, { action: 'CREATE', resourceType: RESOURCE, allow: isPrimaryCareProvider });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the task') }, { status: 400 });
  }
  if (body.clientId) {
    const c = await workflowClientGate(req, g.gate, g.viewer, body.clientId, { action: 'CREATE', resourceType: RESOURCE });
    if (c.ok === false) return c.response;
  }
  try {
    if (body.assignedToId) {
      const ma = await prisma.user.findFirst({
        where: { id: body.assignedToId, organizationId: g.viewer.organizationId, status: 'ACTIVE', OR: [{ role: 'MEDICAL_ASSISTANT' }, { roles: { has: 'MEDICAL_ASSISTANT' } }] },
        select: { id: true },
      });
      if (!ma) return NextResponse.json({ success: false, error: 'Choose an active Medical Assistant' }, { status: 400 });
    }
    const me = await prisma.user.findUnique({ where: { id: g.viewer.userId }, select: { name: true } });
    const row = await prisma.medicalTask.create({
      data: {
        organizationId: g.viewer.organizationId,
        clientId: body.clientId || null,
        title: body.title,
        detail: body.detail || null,
        assignedToId: body.assignedToId || null,
        dueOn: body.dueOn ? new Date(`${body.dueOn}T12:00:00Z`) : null,
        createdById: g.viewer.userId,
        createdByName: me?.name ?? null,
      },
    });
    await auditPhiAccess({ gate: g.gate, req, action: 'CREATE', resourceType: RESOURCE, resourceId: row.id, patientId: body.clientId || null, metadata: { assigned: Boolean(body.assignedToId) } });
    return NextResponse.json({ success: true, id: row.id }, { status: 201 });
  } catch (err) {
    console.error('[medical/tasks POST]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not create the task' }, { status: 500 });
  }
}
