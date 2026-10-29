import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  DISMISS_REASONS,
  dismissProgressNote,
  undoDismissProgressNote,
} from '@/lib/notes/dismiss';

export const runtime = 'nodejs';

const bodySchema = z.object({
  reason: z.enum(DISMISS_REASONS),
  details: z.string().max(300).optional().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid dismiss payload' }, { status: 400 });
  }
  const elevated = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes(gate.role);
  const result = await dismissProgressNote({
    noteId: id,
    actorId: gate.userId,
    actorName: gate.session.user.name || null,
    organizationId: gate.organizationId,
    reason: parsed.data.reason,
    details: parsed.data.details,
    elevated,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, dismissed: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const elevated = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes(gate.role);
  const result = await undoDismissProgressNote({
    noteId: id,
    actorId: gate.userId,
    organizationId: gate.organizationId,
    elevated,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, undone: true });
}
