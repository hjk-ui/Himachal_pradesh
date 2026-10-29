import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

const TRACKS = ['mh-iop', 'sud-iop', 'php'] as const;
const schema = z.object({
  clientId: z.string().min(1),
  track: z.enum(TRACKS),
  days: z.array(z.string().trim().min(2).max(12)).min(1).max(7),
  status: z.enum(['active', 'waitlist']).default('active'),
});

const DEFAULT_DAYS = {
  'mh-iop': ['Monday', 'Wednesday', 'Thursday'],
  'sud-iop': ['Monday', 'Wednesday', 'Thursday'],
  php: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
};

async function phpLicensed(organizationId: string) {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: 'practice:php-licensure' } },
  });
  const data = row?.data as { confirmed?: boolean } | null;
  return Boolean(data?.confirmed);
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/programs/intensive')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: 'intensive:' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const visibleClients = await prisma.client.findMany({
    where: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
    select: { id: true },
  });
  const allowed = new Set(visibleClients.map((client) => client.id));
  const enrollments = rows
    .map((row) => row.data as { clientId?: string })
    .filter((row) => row?.clientId && allowed.has(row.clientId));
  return NextResponse.json({
    success: true,
    phpLicensed: await phpLicensed(gate.organizationId),
    defaults: DEFAULT_DAYS,
    enrollments,
  });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/programs/intensive')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid enrollment' }, { status: 400 });
  if (parsed.data.track === 'php' && !(await phpLicensed(gate.organizationId))) {
    return NextResponse.json({ success: false, error: 'PHP stays off until the practice confirms PHP licensure.' }, { status: 400 });
  }
  const client = await prisma.client.findFirst({
    where: {
      AND: [
        clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
        { id: parsed.data.clientId },
      ],
    },
    select: { id: true, name: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const id = randomUUID();
  const enrollment = {
    id,
    ...parsed.data,
    clientName: client.name,
    part2: parsed.data.track === 'sud-iop',
    createdBy: gate.userId,
  };
  await prisma.clinicModuleState.create({
    data: { organizationId: gate.organizationId, module: `intensive:${id}`, data: enrollment },
  });
  return NextResponse.json({ success: true, enrollment });
}

const licenseSchema = z.object({ confirmPhpLicensure: z.literal(true) });

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = licenseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId: gate.organizationId, module: 'practice:php-licensure' } },
    create: { organizationId: gate.organizationId, module: 'practice:php-licensure', data: { confirmed: true, by: gate.userId } },
    update: { data: { confirmed: true, by: gate.userId } },
  });
  return NextResponse.json({ success: true, phpLicensed: true });
}
