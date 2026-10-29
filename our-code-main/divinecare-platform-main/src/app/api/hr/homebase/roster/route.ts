import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireHomebaseAccess } from '@/lib/homebase/route-gate';
import { listRoster, setRosterMatch } from '@/lib/homebase/sync';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

const matchSchema = z.object({
  linkId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128).nullable(),
  ignore: z.boolean().optional(),
});

export async function GET() {
  const gate = await requireHomebaseAccess();
  if (gate.ok === false) return gate.response;
  const roster = await listRoster(gate.organizationId);
  const staff = roster.length
    ? await prisma.user.findMany({
        where: { organizationId: gate.organizationId, status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];
  await gate.audit('HR_HOMEBASE_ROSTER');
  return NextResponse.json({ success: true, roster, staff });
}

/** Match a Homebase employee to a staff member (local decision only; nothing is sent to Homebase). */
export async function POST(req: Request) {
  const gate = await requireHomebaseAccess();
  if (gate.ok === false) return gate.response;
  const parsed = matchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid match' }, { status: 400 });
  const result = await setRosterMatch({
    organizationId: gate.organizationId,
    actorId: gate.userId,
    linkId: parsed.data.linkId,
    userId: parsed.data.userId ?? null,
    ignore: parsed.data.ignore,
  });
  if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  await gate.audit('HR_HOMEBASE_ROSTER_MATCH');
  return NextResponse.json({ success: true });
}
