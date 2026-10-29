import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const READ_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']);
const WRITE_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']);

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!READ_ROLES.has(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/intensive-charges')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: 'intensive-charge:' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({
    success: true,
    canSubmit: WRITE_ROLES.has(gate.role),
    charges: rows.map((row) => row.data),
  });
}

const createSchema = z.object({
  enrollmentId: z.string().min(1),
  clientId: z.string().min(1),
  track: z.string().min(1),
  amountCents: z.number().int().min(0),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!WRITE_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (body?.submitId) {
    const row = await prisma.clinicModuleState.findUnique({
      where: { organizationId_module: { organizationId: gate.organizationId, module: `intensive-charge:${body.submitId}` } },
    });
    if (!row) return NextResponse.json({ success: false, error: 'Charge draft not found' }, { status: 404 });
    const data = { ...(row.data as object), status: 'submitted', submittedBy: gate.userId };
    await prisma.clinicModuleState.update({
      where: { organizationId_module: { organizationId: gate.organizationId, module: row.module } },
      data: { data },
    });
    return NextResponse.json({ success: true, charge: data, mode: 'test' });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid charge draft' }, { status: 400 });
  const id = randomUUID();
  const charge = { id, ...parsed.data, status: 'draft', mode: 'test' };
  await prisma.clinicModuleState.create({
    data: { organizationId: gate.organizationId, module: `intensive-charge:${id}`, data: charge },
  });
  return NextResponse.json({ success: true, charge });
}
