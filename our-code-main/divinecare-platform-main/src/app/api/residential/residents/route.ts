import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { evaluateAsamLevel, type AsamInput } from '@/services/asamEngine';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/residential')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const program = searchParams.get('program');

    let residents = await prisma.residentialResident.findMany({
      where: {
        active: true,
        clientId: { not: null },
        ...(program && program !== 'all' ? { program } : {}),
      },
      include: {
        shiftNotes: { orderBy: { shiftDate: 'desc' }, take: 5 },
      },
      orderBy: { admitDate: 'desc' },
    });

    return NextResponse.json({ success: true, residents });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch residential census' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/residential')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const now = new Date();
    let program = body.program || '3.5';

    // ASAM 6-Dimension Qualification Gate
    if (body.asamScores) {
      const scores = body.asamScores;
      const asamInput: AsamInput = {
        gates: {
          withdrawalRisk: Boolean(body.withdrawalRisk),
          medicalInstability: Boolean(body.medicalInstability),
          acutePsych: Boolean(body.acutePsych),
        },
        dims: [
          Number(scores.dim1 || 0),
          Number(scores.dim2 || 0),
          Number(scores.dim3 || 0),
          Number(scores.dim4 || 0),
          Number(scores.dim5 || 0),
          Number(scores.dim6 || 0),
        ],
      };

      const evalResult = evaluateAsamLevel(asamInput);
      if (!evalResult.allowed && !body.overrideReason) {
        return NextResponse.json(
          {
            success: false,
            error: `ASAM Gate: Clinical scores indicate ${evalResult.label}. Admission prohibited without documented clinical override justification.`,
            gate: 'ASAM_EXCLUSION_TRIGGERED',
            recommendation: evalResult.level,
          },
          { status: 422 }
        );
      }

      if (evalResult.allowed && !body.program) {
        program = evalResult.level === 'ASAM_3_5' ? '3.5' : '3.1';
      }
    }

    if (!body.clientId || typeof body.clientId !== 'string') {
      return NextResponse.json({ success: false, error: 'A real client is required' }, { status: 400 });
    }
    const client = await prisma.client.findFirst({ where: { id: body.clientId }, select: { id: true, name: true } });
    if (!client) {
      return NextResponse.json({ success: false, error: 'A real client is required' }, { status: 400 });
    }

    const csrDays = program === '3.5' ? 7 : 30;

    const created = await prisma.residentialResident.create({
      data: {
        name: body.name || client.name,
        clientId: client.id,
        program,
        room: body.room || 'Unassigned',
        admitDate: body.admitDate ? new Date(body.admitDate) : now,
        counselor: body.counselor || 'Unassigned',
        phase: body.phase || 'Admission',
        txPlanStatus: 'current',
        orientationDone: Boolean(body.orientationDone),
        asamScores: body.asamScores || null,
        overrideReason: body.overrideReason || null,
        paNumber: body.paNumber || `PA-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        paUnitsRemaining: body.paUnitsRemaining ? Number(body.paUnitsRemaining) : (program === '3.5' ? 30 : 60),
        lastCsrDate: now,
        nextCsrDate: new Date(now.getTime() + csrDays * 86400000),
        active: true,
      },
    });

    return NextResponse.json({ success: true, resident: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not admit resident' },
      { status: 500 }
    );
  }
}
