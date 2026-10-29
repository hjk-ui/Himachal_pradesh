import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  jurisdiction: z.string().trim().min(1).max(80),
  petitionerType: z.string().trim().min(1).max(80),
  narrative: z.string().trim().max(8000),
  affidavitOn: z.string().trim().max(20),
});

const CASELOAD = new Set(['PEER_SUPPORT', 'CASE_MANAGER', 'PRP_SPECIALIST']);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/aot')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: 'aot-form:' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  let forms = rows.map((row) => row.data as { clientId?: string });
  if (CASELOAD.has(gate.role)) {
    const mine = await prisma.client.findMany({
      where: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
      select: { id: true },
    });
    const ids = new Set(mine.map((client) => client.id));
    forms = forms.filter((form) => form.clientId && ids.has(form.clientId));
  }
  return NextResponse.json({ success: true, forms });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/aot')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'A client and jurisdiction are required' }, { status: 400 });
  const where = CASELOAD.has(gate.role)
    ? { AND: [{ id: parsed.data.clientId }, clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role })] }
    : { id: parsed.data.clientId, organizationId: gate.organizationId };
  const client = await prisma.client.findFirst({ where, select: { id: true, name: true } });
  if (!client) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const id = randomUUID();
  const form = { id, ...parsed.data, clientName: client.name };
  await prisma.clinicModuleState.create({
    data: { organizationId: gate.organizationId, module: `aot-form:${id}`, data: form },
  });
  return NextResponse.json({ success: true, form }, { status: 201 });
}
