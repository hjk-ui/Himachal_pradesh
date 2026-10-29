import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { canViewPrescriptions } from '@/lib/prescriptions/access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prescriptions/pharmacies — pharmacies this organization's prescriptions use.
 * practice_pharmacies has no organization column, so the org filter goes through
 * EhrPrescription -> Client (clientOrgFilter): another clinic's pharmacy list is never returned.
 * Prescription viewers only (canViewPrescriptions).
 */
export async function GET(_req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canViewPrescriptions(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const pharmacies = await prisma.practicePharmacy.findMany({
      where: {
        active: true,
        prescriptions: { some: { client: clientOrgFilter(gate.organizationId) } },
      },
      select: {
        id: true, ncpdpId: true, storeName: true, chainName: true, phone: true, fax: true,
        addressLine1: true, city: true, state: true, zipCode: true, active: true,
      },
      orderBy: { storeName: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: pharmacies,
    });
  } catch (err: unknown) {
    console.error('[API /api/prescriptions/pharmacies] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pharmacies' },
      { status: 500 }
    );
  }
}
