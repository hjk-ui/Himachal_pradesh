import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { createClientCheckIn, listClientCheckIns } from '@/lib/clients/checkIns';
import { canSeeClientCheckIns, canWriteClientCheckIns } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const createSchema = z.object({
  mood: z.number().int().min(1).max(10),
  stress: z.number().int().min(1).max(10),
  sleep: z.number().int().min(1).max(10).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  // Mood / stress / sleep scores and the patient's note: the BH care team only (canSeeClientCheckIns);
  // not Front Desk, Office Manager, Billing, HR or primary care roles.
  if (!canSeeClientCheckIns(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'checkIn', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const result = await listClientCheckIns({
    clientId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  if (result.ok === false) {
    if (result.status === 403 || result.status === 404) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'checkIn', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { status: result.status } });
    }
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

  await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'checkIn', resourceId: id, patientId: id, metadata: { count: Array.isArray(result.checkIns) ? result.checkIns.length : null } });

  return NextResponse.json({ success: true, checkIns: result.checkIns });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // Not Peer Support / Billing / HR / primary care roles (orgScope.canWriteClientCheckIns)
  if (!canWriteClientCheckIns(gate.role)) {
    const { id: deniedId } = await ctx.params;
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'checkIn', resourceId: deniedId, patientId: deniedId, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = createSchema.parse(await req.json());
    const result = await createClientCheckIn({
      clientId: id,
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      mood: body.mood,
      stress: body.stress,
      sleep: body.sleep,
      note: body.note,
    });

    if (result.ok === false) {
      if (result.status === 403 || result.status === 404) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'checkIn', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { status: result.status } });
      }
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'checkIn',
      resourceId: (result.checkIn as { id?: string } | null)?.id ?? null,
      patientId: id,
      metadata: { fields: Object.keys(body).filter((k) => body[k as keyof typeof body] != null) },
    });

    return NextResponse.json(
      { success: true, checkIn: result.checkIn, client: result.client },
      { status: 201 }
    );
  } catch (err: any) {
    const message =
      err instanceof z.ZodError
        ? 'Mood, stress, and sleep must be whole numbers from 1 to 10'
        : err.message || 'Could not save check-in';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
