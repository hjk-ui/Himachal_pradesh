import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { createClientCheckIn, listClientCheckIns } from '@/lib/clients/checkIns';
import { isClinicalStaff } from '@/types/roles';

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

function canWriteCheckIns(role: string) {
  return isClinicalStaff(role) || role === 'FRONT_DESK';
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { id } = paramsSchema.parse(await ctx.params);
  const result = await listClientCheckIns({
    clientId: id,
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });

  if (result.ok === false) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.status }
    );
  }

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

  if (!canWriteCheckIns(gate.role)) {
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
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

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
