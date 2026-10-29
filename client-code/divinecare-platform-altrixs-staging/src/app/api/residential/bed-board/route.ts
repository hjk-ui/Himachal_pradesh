import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { orgClientIdSet, residentRowsInOrg } from '../_scope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { occupancyByLevel, summarizeCapacity, totalOccupancy, BEDS_NOT_CONFIGURED } from '@/lib/residential/capacity';
import { loadResidentialCapacity } from '@/lib/residential/capacityServer';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const program = searchParams.get('program');

    let residents = await prisma.residentialResident.findMany({
      where: {
        active: true,
        ...(program && program !== 'all' ? { program } : {}),
      },
      include: {
        shiftNotes: { orderBy: { shiftDate: 'desc' }, take: 1 },
      },
      orderBy: { room: 'asc' },
    });

    // No organizationId column: keep only residents linked to a client in this org; unlinked
    // residents are hidden (same rule as /api/residential/residents; needs an organizationId
    // column, future migration).
    residents = residentRowsInOrg(residents, await orgClientIdSet(residents.map((r) => r.clientId), gate.organizationId), (r) => r.clientId);
    // Beds from Practice settings > Programs & capacity; null when not configured (no default).
    // Occupancy counts every org resident (counts only); the resident list below is caseload-filtered.
    const capacity = summarizeCapacity((await loadResidentialCapacity(gate.organizationId)).rows);
    const levels = occupancyByLevel(capacity, residents.map((r) => r.program));
    const total = totalOccupancy(levels);
    const totalBeds = total.beds;
    const occupiedBeds = residents.length;
    const unitB35 = residents.filter((r) => r.program === '3.5');
    const unitA31 = residents.filter((r) => r.program === '3.1');

    residents = filterRowsToCaseload(residents, await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }));

    // ASAM dimension severity distribution
    const asamDimensions = {
      dim1_intoxication: { low: 0, moderate: 0, high: 0 },
      dim2_biomedical: { low: 0, moderate: 0, high: 0 },
      dim3_emotional: { low: 0, moderate: 0, high: 0 },
      dim4_readiness: { low: 0, moderate: 0, high: 0 },
      dim5_relapse: { low: 0, moderate: 0, high: 0 },
      dim6_recovery_env: { low: 0, moderate: 0, high: 0 },
    };

    residents.forEach((r) => {
      const scores = r.asamScores as Record<string, number> | null;
      if (scores) {
        Object.entries(scores).forEach(([dim, val]) => {
          const key = dim as keyof typeof asamDimensions;
          if (asamDimensions[key]) {
            if (val >= 3) asamDimensions[key].high++;
            else if (val >= 2) asamDimensions[key].moderate++;
            else asamDimensions[key].low++;
          }
        });
      }
    });

    const now = new Date();
    const csrAlerts = residents.map((r) => {
      const nextCsr = r.nextCsrDate ? new Date(r.nextCsrDate) : null;
      const isOverdue = nextCsr ? nextCsr < now : false;
      const daysLeft = nextCsr ? Math.ceil((nextCsr.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 7;
      return {
        id: r.id,
        name: r.name,
        room: r.room,
        program: r.program,
        nextCsrDate: r.nextCsrDate,
        isOverdue,
        daysLeft,
        paUnitsRemaining: r.paUnitsRemaining,
      };
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'residentialBedBoard',
      metadata: { count: residents.length, patientIds: residents.map((r) => r.clientId).filter(Boolean).slice(0, 50), filters: { program: program || null } },
    });

    return NextResponse.json({
      success: true,
      census: {
        totalBeds,
        occupiedBeds,
        availableBeds: total.open,
        occupancyRate: total.occupancyPct === null ? null : `${total.occupancyPct}%`,
        bedsConfigured: capacity.configured,
        bedsNote: capacity.configured ? null : BEDS_NOT_CONFIGURED,
        levels,
        asam35Count: unitB35.length,
        asam31Count: unitA31.length,
      },
      residents,
      asamDimensions,
      csrAlerts,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch bed board' },
      { status: 500 }
    );
  }
}
