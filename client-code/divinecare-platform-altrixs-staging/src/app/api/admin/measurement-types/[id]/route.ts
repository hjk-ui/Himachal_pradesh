import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { MEASUREMENT_TYPE_EDIT_ROLES } from '@/lib/clinical/measurementTypeAccess';

export const runtime = 'nodejs';

const patchSchema = z.object({ active: z.boolean() }).strict();

/**
 * PATCH /api/admin/measurement-types/[id] — turn a measurement type on or off (leadership).
 * Inactive types leave the "Record a measure" picker; values already recorded are kept.
 * A Valant re-import never changes this toggle.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!MEASUREMENT_TYPE_EDIT_ROLES.has(String(gate.role).toUpperCase())) {
    return NextResponse.json({ success: false, error: 'Only Practice Director or Admin can change measurement types' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const row = await prisma.measurementType.findFirst({ where: { id, organizationId: gate.organizationId }, select: { id: true, active: true, name: true } });
    if (!row) return NextResponse.json({ success: false, error: 'Measurement type not found' }, { status: 404 });
    const updated = await prisma.measurementType.update({ where: { id: row.id }, data: { active: body.active, updatedById: gate.userId } });
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'measurementType', resourceId: row.id,
      metadata: { field: 'active', from: row.active, to: body.active },
    });
    return NextResponse.json({ success: true, data: { id: updated.id, active: updated.active } });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Send { active: true | false }' }, { status: 400 });
    console.error('[admin/measurement-types PATCH]', err);
    return NextResponse.json({ success: false, error: 'Could not update the measurement type' }, { status: 500 });
  }
}
