import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const specialists = await prisma.user.findMany({
    where: {
      organizationId: gate.organizationId,
      role: 'PRP_SPECIALIST',
      status: 'ACTIVE',
    },
    select: { id: true, name: true, email: true },
    take: 50,
  });

  const withLoad = await Promise.all(
    specialists.map(async (s) => {
      const caseload = await prisma.prpEnrollment.count({
        where: { organizationId: gate.organizationId, specialistId: s.id, status: 'active' },
      });
      // No caseload limit is configured anywhere, so none is invented here.
      return { id: s.id, name: s.name || s.email, caseload };
    })
  );

  return NextResponse.json({ success: true, specialists: withLoad });
}
