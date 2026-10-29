import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientIdInOrg, listParticipantsInOrg, redactAotParticipant } from '../_scope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';
import { MDH_AFFIDAVIT_TIMING_CAVEAT, MDH_AFFIDAVIT_TIMING_TEXT, orderTermProblem, petitionerIssueIn } from '@/lib/aot/mdh';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const county = searchParams.get('county');

    // Peer Support / Case Manager / PRP: only participants linked to their own caseload
    const participants = filterRowsToCaseload(
      await listParticipantsInOrg(gate.organizationId, { status, county }),
      await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }),
    );

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'aotParticipant',
      metadata: {
        count: participants.length,
        ids: participants.slice(0, 50).map((p) => p.id),
        filters: { status: status || null, county: county || null },
      },
    });

    // Clinical columns only for the EHR clinical roles (redactAotParticipant)
    return NextResponse.json({ success: true, participants: participants.map((p) => redactAotParticipant(p, gate.role)) });
  } catch (err: unknown) {
    // Database errors can quote patient data: log them, return a generic message
    console.error('[aot/participants GET]', err);
    return NextResponse.json({ success: false, error: 'Could not fetch AOT participants' }, { status: 500 });
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

    // Exam timing is a WARNING only (MDH wording is ambiguous; counsel confirms the window), never a block.
    const warnings: string[] = [];
    if (body.psychiatristAffidavit && body.psychiatristAffidavit.examDate) {
      const examDate = new Date(body.psychiatristAffidavit.examDate).getTime();
      const filingDate = body.petitionDate ? new Date(body.petitionDate).getTime() : Date.now();
      const diffDays = Math.floor((filingDate - examDate) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) {
        warnings.push(`Psychiatric examination is ${diffDays} days before filing. MDH: "${MDH_AFFIDAVIT_TIMING_TEXT}" ${MDH_AFFIDAVIT_TIMING_CAVEAT}`);
      }
    }

    const termProblem = orderTermProblem(body.orderStart, body.orderEnd);
    if (termProblem) {
      return NextResponse.json({ success: false, error: termProblem }, { status: 400 });
    }
    const petitionerIssue = petitionerIssueIn(body.eligibilityData);
    if (petitionerIssue) {
      return NextResponse.json({ success: false, error: petitionerIssue }, { status: 400 });
    }

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ success: false, error: 'Respondent name is required' }, { status: 400 });
    }
    const clientId = await clientIdInOrg(body.clientId, gate.organizationId);
    if (clientId === false) {
      return NextResponse.json({ success: false, error: 'Client not found in your organization' }, { status: 404 });
    }

    // No defaults that read as facts: missing values are stored as "not documented" (age 0 = not recorded).
    const created = await prisma.aotParticipant.create({
      data: {
        organizationId: gate.organizationId,
        name: body.name.trim(),
        clientId,
        age: Number(body.age) > 0 ? Math.floor(Number(body.age)) : 0,
        status: body.status || 'screening',
        county: body.county || 'Not documented',
        referralSource: body.referralSource || 'Not documented',
        diagnosis: body.diagnosis || 'Not documented, confirm with physician affidavit',
        petitionDate: body.petitionDate ? new Date(body.petitionDate) : null,
        hearingDate: body.hearingDate ? new Date(body.hearingDate) : null,
        orderStart: body.orderStart ? new Date(body.orderStart) : null,
        orderEnd: body.orderEnd ? new Date(body.orderEnd) : null,
        eligibilityData: body.eligibilityData || null,
        psychiatristAffidavit: body.psychiatristAffidavit || null,
        deadlines: body.deadlines || [],
        teamCadence: body.teamCadence || [],
        escalationEvents: body.escalationEvents || [],
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'aotParticipant',
      resourceId: created.id,
      patientId: created.clientId ?? null,
      metadata: { fields: Object.keys(body).slice(0, 50) },
    });

    return NextResponse.json({ success: true, participant: created, warnings }, { status: 201 });
  } catch (err: unknown) {
    console.error('[aot/participants POST]', err);
    return NextResponse.json({ success: false, error: 'Could not create AOT participant' }, { status: 500 });
  }
}
