import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const calls = await prisma.operationalCallLog.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    return NextResponse.json({
      success: true,
      data: calls.map(c => ({
        id: c.id,
        name: c.calleeName,
        phone: c.destinationPhone,
        kind: c.callType === 'QUEUE' ? 'queue' : c.callType === 'AGENT' ? 'staff' : 'external',
        duration: c.durationSeconds,
        time: c.createdAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to query operational calls';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
