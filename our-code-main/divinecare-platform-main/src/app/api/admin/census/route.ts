import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/admin/census')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const clients = await prisma.client.findMany({
    where: { organizationId: gate.organizationId, status: 'ACTIVE' },
    select: { id: true, name: true, location: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const byLocation = new Map<string, { location: string; count: number }>();
  for (const client of clients) {
    const location = client.location?.name || 'No location';
    const row = byLocation.get(location) || { location, count: 0 };
    row.count += 1;
    byLocation.set(location, row);
  }
  return NextResponse.json({
    success: true,
    total: clients.length,
    locations: [...byLocation.values()],
  });
}
