import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { parseAsamScores } from '@/lib/residential/asamScores';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { orgClientIdSet, residentRowsInOrg } from '../_scope';
import { evaluateAsamLevel, type AsamInput } from '@/services/asamEngine';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { promptCarelonForProgram } from '@/lib/consents/carelon/trigger';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';

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
        shiftNotes: { orderBy: { shiftDate: 'desc' }, take: 5 },
      },
      orderBy: { admitDate: 'desc' },
    });

    // No organizationId column yet: keep only residents linked to a client in this org. Unlinked
    // residents cannot be verified and are hidden from every org (needs an organizationId column,
    // future migration).
    residents = residentRowsInOrg(residents, await orgClientIdSet(residents.map((r) => r.clientId), gate.organizationId), (r) => r.clientId);
    // Peer Support / Case Manager / PRP: only residents linked to their own caseload
    residents = filterRowsToCaseload(residents, await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }));

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'residentialResident',
      metadata: {
        count: residents.length,
        ids: residents.slice(0, 50).map((r) => r.id),
        patientIds: residents.map((r) => r.clientId).filter(Boolean).slice(0, 50),
        filters: { program: program || null },
      },
    });

    return NextResponse.json({ success: true, residents });
  } catch (err: unknown) {
    console.error('[api/residential/residents GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not fetch residential census' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const plan = await requireFeatureWrite(gate.organizationId, 'programs');
  if (plan.ok === false) {
    return NextResponse.json({ success: false, error: plan.error, code: plan.code }, { status: plan.status });
  }

  try {
    const body = await req.json();
    if (!body.name || !body.room) {
      return NextResponse.json({ success: false, error: 'Resident name and room are required' }, { status: 400 });
    }
    const now = new Date();
    let program = body.program || '3.5';

    // ASAM 6-Dimension Qualification Gate: all six dimensions rated, or no scores at all (never defaulted)
    const asam = parseAsamScores(body.asamScores);
    if (asam.kind === 'invalid') {
      return NextResponse.json(
        { success: false, error: `Rate every ASAM dimension (missing: ${asam.missing.join(', ')}) or send no scores.` },
        { status: 400 }
      );
    }
    if (asam.kind === 'ok') {
      const scores = asam.scores;
      const asamInput: AsamInput = {
        gates: {
          withdrawalRisk: Boolean(body.withdrawalRisk),
          medicalInstability: Boolean(body.medicalInstability),
          acutePsych: Boolean(body.acutePsych),
        },
        dims: [
          scores.dim1,
          scores.dim2,
          scores.dim3,
          scores.dim4,
          scores.dim5,
          scores.dim6,
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

    const csrDays = program === '3.5' ? 7 : 30;

    // The resident must be linked to a client chart in this org: with no organizationId column the
    // chart is the only tenant link (unlinked residents are hidden from every org).
    const linked = typeof body.clientId === 'string' && body.clientId
      ? await prisma.client.findFirst({ where: { id: body.clientId, AND: [clientOrgFilter(gate.organizationId)] }, select: { id: true } })
      : null;
    if (!linked) {
      return NextResponse.json(
        { success: false, error: 'Link the resident to a client chart in this organization before admitting.' },
        { status: body.clientId ? 404 : 400 }
      );
    }

    const created = await prisma.residentialResident.create({
      data: {
        name: body.name || 'New Resident',
        clientId: linked.id,
        program,
        room: body.room,
        admitDate: body.admitDate ? new Date(body.admitDate) : now,
        counselor: body.counselor || 'Unassigned',
        phase: body.phase || 'Admission',
        // A new admission has no treatment plan yet (due within 96 hrs).
        txPlanStatus: 'due',
        orientationDone: Boolean(body.orientationDone),
        asamScores: asam.kind === 'ok' ? asam.scores : Prisma.JsonNull,
        overrideReason: body.overrideReason || null,
        // Never invent a prior-auth number — leave it empty until the real PA is entered.
        paNumber: body.paNumber || null,
        // Units come only from the authorization; with none entered, per-diem billing stays blocked (pa_exhausted).
        paUnitsRemaining: body.paUnitsRemaining ? Number(body.paUnitsRemaining) : 0,
        lastCsrDate: now,
        nextCsrDate: new Date(now.getTime() + csrDays * 86400000),
        active: true,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'residentialResident',
      resourceId: created.id,
      patientId: created.clientId ?? null,
      metadata: {
        program: created.program,
        asamOverride: Boolean(created.overrideReason),
        fields: Object.keys(body).slice(0, 50),
      },
    });

    // Maryland Medicaid: a residential admission prompts a new Carelon non-overlap attestation
    await promptCarelonForProgram({ gate, req, clientId: created.clientId, program: 'residential', trigger: 'residential_admission' });

    return NextResponse.json({ success: true, resident: created }, { status: 201 });
  } catch (err: unknown) {
    console.error('[api/residential/residents POST] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not admit resident' },
      { status: 500 }
    );
  }
}
