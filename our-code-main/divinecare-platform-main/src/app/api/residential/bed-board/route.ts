import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const program = searchParams.get('program');

    const residents = await prisma.residentialResident.findMany({
      where: {
        active: true,
        ...(program && program !== 'all' ? { program } : {}),
      },
      include: {
        shiftNotes: { orderBy: { shiftDate: 'desc' }, take: 1 },
      },
      orderBy: { room: 'asc' },
    });

    const totalBeds = 14;
    const occupiedBeds = residents.length;
    const occupancyRate = Math.round((occupiedBeds / totalBeds) * 100);

    const unitB35 = residents.filter((r) => r.program === '3.5');
    const unitA31 = residents.filter((r) => r.program === '3.1');

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

    return NextResponse.json({
      success: true,
      census: {
        totalBeds,
        occupiedBeds,
        availableBeds: Math.max(0, totalBeds - occupiedBeds),
        occupancyRate: `${occupancyRate}%`,
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
