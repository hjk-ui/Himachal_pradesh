import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { listMedicalTasks, createMedicalTask } from '@/lib/medical/tasks';

export const runtime = 'nodejs';

const ROLES = new Set([
  'MEDICAL_ASSISTANT',
  'PHYSICIAN',
  'MEDICAL_NP',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId') || undefined;
  const status = url.searchParams.get('status') as
    | 'open'
    | 'in_progress'
    | 'done'
    | 'cancelled'
    | null;
  const tasks = await listMedicalTasks(gate.organizationId, {
    clientId,
    status: status || undefined,
  });
  return NextResponse.json({ success: true, tasks });
}

const postSchema = z.object({
  clientId: z.string().min(1),
  clientName: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  note: z.string().max(2000).optional(),
  assignedToRole: z.enum(['MEDICAL_ASSISTANT', 'PHYSICIAN', 'MEDICAL_NP', 'ANY']).optional(),
  appointmentId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid task' }, { status: 400 });
  }
  const task = await createMedicalTask(gate.organizationId, {
    ...parsed.data,
    actorUserId: gate.userId,
  });
  return NextResponse.json({ success: true, task }, { status: 201 });
}
