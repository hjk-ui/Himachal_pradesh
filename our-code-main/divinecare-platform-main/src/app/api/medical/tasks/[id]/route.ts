import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { patchMedicalTask } from '@/lib/medical/tasks';

export const runtime = 'nodejs';

const ROLES = new Set([
  'MEDICAL_ASSISTANT',
  'PHYSICIAN',
  'MEDICAL_NP',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  note: z.string().max(2000).optional(),
  title: z.string().min(1).max(300).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid task update' }, { status: 400 });
  }
  const result = await patchMedicalTask(gate.organizationId, id, parsed.data);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: 404 });
  }
  return NextResponse.json({ success: true, task: result.task });
}
