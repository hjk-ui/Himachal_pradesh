import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { listCalls } from '@/lib/connect/service';

type Params = { params: Promise<{ clientId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/communications')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { clientId } = await params;
  const client = await prisma.client.findFirst({
    where: { id: clientId, AND: [clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role })] },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

  const calls = await listCalls(gate.organizationId, clientId);
  return NextResponse.json({ success: true, calls });
}
