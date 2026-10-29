import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const patchSchema = z.object({
  add: z.array(z.string().min(1).max(128)).max(50).optional(),
  remove: z.array(z.string().min(1).max(128)).max(50).optional(),
});

/** PATCH /api/sensitive-records/[clientId]/whitelist */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ clientId: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!isSensitivePrivilegedRole(gate.role)) {
    const { clientId: deniedId } = await ctx.params;
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'sensitiveRecordWhitelist', resourceId: deniedId, patientId: deniedId, outcome: 'DENIED', metadata: { reason: 'role_not_privileged' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { clientId } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const add = body.add ?? [];
    const remove = body.remove ?? [];

    if (!add.length && !remove.length) {
      return NextResponse.json(
        { success: false, error: 'Provide add and/or remove user ids' },
        { status: 400 }
      );
    }

    const existing = await prisma.sensitiveRecord.findFirst({
      where: { clientId, organizationId: gate.organizationId },
    });
    if (!existing) {
      await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'sensitiveRecordWhitelist', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: 'protection_not_found' } });
      return NextResponse.json({ success: false, error: 'Protection not found' }, { status: 404 });
    }

    if (add.length) {
      const staff = await prisma.user.findMany({
        where: { id: { in: add }, organizationId: gate.organizationId },
        select: { id: true },
      });
      if (staff.length !== add.length) {
        return NextResponse.json(
          { success: false, error: 'Cannot whitelist users outside this organization' },
          { status: 400 }
        );
      }
    }

    const removeSet = new Set(remove);
    const next = [
      ...new Set([...existing.accessWhitelist.filter((id) => !removeSet.has(id)), ...add]),
    ];

    const record = await prisma.sensitiveRecord.update({
      where: { id: existing.id },
      data: { accessWhitelist: next, setById: gate.userId },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'sensitiveRecordWhitelist',
      resourceId: record.id,
      patientId: clientId,
      metadata: { fields: ['accessWhitelist'], addedUserIds: add, removedUserIds: remove, whitelistCount: record.accessWhitelist.length },
    });

    return NextResponse.json({
      success: true,
      accessWhitelist: record.accessWhitelist,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.issues[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    console.error('[sensitive-records whitelist PATCH]', err);
    return NextResponse.json(
      { success: false, error: 'Could not update whitelist' },
      { status: 500 }
    );
  }
}
