import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json();
  const client = await prisma.client.findFirst({
    where: { id: body.clientId, ...clientOrgFilter(gate.organizationId) },
    select: { id: true, name: true, insurancePayer: true, insuranceMemberId: true },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const pa = await prisma.priorAuth.create({
    data: {
      organizationId: gate.organizationId,
      clientId: client.id,
      payer: client.insurancePayer || 'Medicaid',
      cptCodes: [body.cpt || 'H2017'],
      unitsApproved: Number(body.units) || 60,
      unitsUsed: 0,
      status: 'DRAFT',
      notes: `PRP enroll PA · ${body.days || 90}-day · created from enroll wizard`,
      createdById: gate.userId,
    },
  });

  return NextResponse.json({ success: true, priorAuthId: pa.id }, { status: 201 });
}
