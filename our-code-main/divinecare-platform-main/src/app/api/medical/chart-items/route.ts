import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const schema = z.object({
  kind: z.enum(['order', 'standing-lab', 'rooming', 'visit', 'care-gap']),
  clientId: z.string().min(1),
  text: z.string().trim().min(1).max(500),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/medical')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const clientId = new URL(req.url).searchParams.get('clientId') || '';
  const rows = clientId
    ? await prisma.clinicModuleState.findMany({
        where: { organizationId: gate.organizationId, module: { startsWith: `chart-item:${clientId}:` } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : [];
  return NextResponse.json({ success: true, items: rows.map((row) => row.data) });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/medical')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'A client and a description are required.' }, { status: 400 });
  let client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, organizationId: gate.organizationId },
    select: { id: true },
  });
  if (!client) {
    const medical = await prisma.medicalPatient.findFirst({
      where: { organizationId: gate.organizationId, OR: [{ id: parsed.data.clientId }, { mrn: parsed.data.clientId }] },
      select: { bhClientId: true },
    });
    if (medical?.bhClientId) {
      client = await prisma.client.findFirst({
        where: { id: medical.bhClientId, organizationId: gate.organizationId },
        select: { id: true },
      });
    }
  }
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  const id = randomUUID();
  const standing = parsed.data.kind === 'standing-lab';
  const rooming = parsed.data.kind === 'rooming';
  const visit = parsed.data.kind === 'visit';
  if (visit && gate.role !== 'PHYSICIAN' && gate.role !== 'MEDICAL_NP') {
    return NextResponse.json({ success: false, error: 'Only the physician or medical NP can complete the visit.' }, { status: 403 });
  }
  const item = {
    id,
    ...parsed.data,
    status: visit
      ? 'completed'
      : standing
      ? (gate.role === 'MEDICAL_ASSISTANT' ? 'draft' : 'reminder')
      : rooming
      ? 'waiting-for-provider'
      : 'saved',
    placesLab: false,
  };
  await prisma.clinicModuleState.create({
    data: { organizationId: gate.organizationId, module: `chart-item:${client.id}:${id}`, data: item },
  });
  return NextResponse.json({
    success: true,
    message: visit
      ? 'Visit completed and saved on the chart.'
      : rooming
      ? 'Patient is roomed and waiting for the provider.'
      : standing
      ? 'Standing lab saved as a reminder. It does not place the lab.'
      : parsed.data.kind === 'care-gap'
      ? 'Care gap opened on the chart.'
      : 'Order saved on the chart.',
    item,
  });
}
