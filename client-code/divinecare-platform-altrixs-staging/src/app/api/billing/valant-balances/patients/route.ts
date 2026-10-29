import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireValantBalancesGate } from '@/lib/billing/valantGate';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

/**
 * GET /api/billing/valant-balances/patients?q=... — patient picker for the prepayment Unmatched queue.
 * Search by name or MRN; DOB is returned so staff can tell patients with the same name apart.
 */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (q.length < 2) return NextResponse.json({ success: true, patients: [] });
    const words = q.split(' ').slice(0, 4);
    const clients = await prisma.client.findMany({
      where: {
        organizationId: gate.organizationId,
        OR: [
          { mrn: { equals: q, mode: 'insensitive' } },
          { sourceId: { equals: q, mode: 'insensitive' } },
          { AND: words.map((w) => ({ OR: [
            { name: { contains: w, mode: 'insensitive' as const } },
            { legalFirstName: { contains: w, mode: 'insensitive' as const } },
            { legalLastName: { contains: w, mode: 'insensitive' as const } },
          ] })) },
        ],
      },
      select: { id: true, name: true, mrn: true, dateOfBirth: true, status: true, sourceId: true, sourcePlatform: true },
      orderBy: { name: 'asc' },
      take: 25,
    });
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'client',
      metadata: { view: 'valant_prepayment_patient_search', count: clients.length },
    });
    return NextResponse.json({
      success: true,
      patients: clients.map((c) => ({
        id: c.id, name: c.name, mrn: c.mrn, dateOfBirth: isoDate(c.dateOfBirth), status: c.status,
        valantId: c.sourcePlatform === 'valant' ? c.sourceId : null,
      })),
    });
  } catch (err) {
    console.error('[valant-balances patients GET]', err);
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 });
  }
}
