import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canManageCredentialing } from '@/lib/hr/credentialingAccess';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canManageCredentialing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    // The enrollment table has no org column: scope to providers who are users of the caller's org.
    const users = await prisma.user.findMany({
      where: { organizationId: gate.organizationId },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    const enrollments = ids.length
      ? await prisma.providerPayerEnrollment.findMany({
          where: { providerUserId: { in: ids } },
          orderBy: { updatedAt: 'desc' },
        })
      : [];

    return NextResponse.json({
      success: true,
      enrollments,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to query intake grid' },
      { status: 500 }
    );
  }
}
