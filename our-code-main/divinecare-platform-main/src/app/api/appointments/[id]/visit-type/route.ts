import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { changeVisitType, getVisitType } from '@/lib/appointments/visitTypeChange';
import { VISIT_TYPE_REASON_MAX } from '@/lib/appointments/visitType';

export const runtime = 'nodejs';

const patchSchema = z.object({
  visitType: z.enum(['in_person', 'telehealth']),
  reason: z.string().max(VISIT_TYPE_REASON_MAX).optional().nullable(),
});

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/appointments/[id]/visit-type — current visit type, catalog, and lock state. */
export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  const result = await getVisitType(id, {
    id: gate.userId,
    role: gate.role,
    organizationId: gate.organizationId,
  });
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    success: true,
    visitType: result.visitType,
    catalog: result.catalog,
    lock: result.lock,
  });
}

/** PATCH /api/appointments/[id]/visit-type — { visitType, reason? } */
export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid visit type change' },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;
  const result = await changeVisitType(id, parsed.data, {
    id: gate.userId,
    role: gate.role,
    organizationId: gate.organizationId,
  });
  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error, ...('code' in result ? { code: result.code } : {}) },
      { status: result.status }
    );
  }
  return NextResponse.json({ success: true, visitType: result.visitType });
}
