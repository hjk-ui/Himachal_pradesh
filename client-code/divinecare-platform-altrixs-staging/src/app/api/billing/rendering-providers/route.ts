import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

/**
 * Active staff in the caller's organization who have an NPI on file
 * (User.npi, falling back to the HR directory profile). Feeds the claim
 * editor's rendering-provider picker.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/billing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        organizationId: gate.organizationId,
        status: 'ACTIVE',
        OR: [{ npi: { not: null } }, { staffHrProfile: { npi: { not: null } } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        npi: true,
        staffHrProfile: { select: { npi: true, jobTitle: true } },
      },
      orderBy: { name: 'asc' },
    });

    const providers = users
      .map((u) => {
        const npi = [u.npi, u.staffHrProfile?.npi]
          .map((v) => (v || '').replace(/\D/g, ''))
          .find((v) => v.length === 10);
        if (!npi) return null;
        return {
          id: u.id,
          name: u.name || u.email,
          npi,
          title: u.staffHrProfile?.jobTitle || String(u.role),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return NextResponse.json({ success: true, providers });
  } catch (err: unknown) {
    console.error('[billing rendering-providers GET]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load providers' }, { status: 500 });
  }
}
