import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { AOT_RESTRICTED_LABEL, canSeeAotClinical, clientIdInOrg, findParticipantInOrg, listParticipantsInOrg, participantOnCaseload } from '../_scope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';
import { flagsForParticipants } from '@/lib/aot/documents';
import { checklistFromEligibility, hasOperationalCct, orderTermProblem, petitionChecklistFlags, petitionerIssueIn } from '@/lib/aot/mdh';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const countyParam = searchParams.get('county');

    // Peer Support / Case Manager / PRP: only participants linked to their own caseload (as /api/aot/participants)
    const allRecords = filterRowsToCaseload(
      await listParticipantsInOrg(gate.organizationId, { status: statusParam, county: countyParam }),
      await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }),
    );
    // Diagnosis, eligibility criteria and non-adherence events: EHR clinical roles only
    const clinical = canSeeAotClinical(gate.role);
    const linkedIds = Array.from(new Set(allRecords.map((p) => p.clientId).filter((v): v is string => !!v)));

    const now = new Date();
    // MDH form deadlines (continued plan, unsigned treatment plan / affidavit, non-responsive outreach) and EP events
    const formState = await flagsForParticipants(gate.organizationId, allRecords, now);

    const caseboard = allRecords
      .filter((p) => p.status !== 'referral')
      .map((p) => {
        const hearingDate = p.hearingDate ? new Date(p.hearingDate) : null;
        const orderEnd = p.orderEnd ? new Date(p.orderEnd) : null;
        const daysUntilHearing = hearingDate
          ? Math.ceil((hearingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const daysUntilOrderExpires = orderEnd
          ? Math.ceil((orderEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        const rawDeadlines = Array.isArray(p.deadlines) ? (p.deadlines as any[]) : [];
        const deadlines = rawDeadlines.map((d, i) => {
          const daysLeft = d.due
            ? Math.ceil((new Date(d.due).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : (d.daysLeft ?? 0);
          const flagStatus =
            d.status === 'done'
              ? 'done'
              : daysLeft < 0
              ? 'overdue'
              : daysLeft <= 7
              ? 'due'
              : 'upcoming';
          return {
            id: d.id || `dl-${p.id}-${i}`,
            label: d.label,
            due: d.due,
            daysLeft,
            status: flagStatus,
            basis: d.basis || 'Statutory condition',
          };
        });

        const team = Array.isArray(p.teamCadence) ? p.teamCadence : [];
        const nonAdherence = Array.isArray(p.escalationEvents) ? p.escalationEvents : [];

        return {
          id: p.id,
          name: p.name,
          age: p.age > 0 ? p.age : null,
          status: p.status,
          county: p.county,
          referralSource: p.referralSource,
          diagnosis: clinical ? p.diagnosis : AOT_RESTRICTED_LABEL,
          petitionDate: p.petitionDate ? p.petitionDate.toISOString().slice(0, 10) : undefined,
          hearingDate: p.hearingDate ? p.hearingDate.toISOString().slice(0, 10) : undefined,
          orderStart: p.orderStart ? p.orderStart.toISOString().slice(0, 10) : undefined,
          orderEnd: p.orderEnd ? p.orderEnd.toISOString().slice(0, 10) : undefined,
          daysUntilHearing,
          daysUntilOrderExpires,
          deadlines,
          team,
          nonAdherence: clinical ? nonAdherence : [],
          clinicalRestricted: !clinical,
          formFlags: formState.get(p.id)?.flags ?? [],
          // MDH petition steps (eligibilityData.petitionChecklist); open items flag at petition / hearing
          petitionChecklist: checklistFromEligibility(p.eligibilityData),
          checklistFlags: petitionChecklistFlags(p.status, checklistFromEligibility(p.eligibilityData)),
          cctOperational: hasOperationalCct(p.county),
          lastEmergencyPetition: formState.get(p.id)?.lastEp ?? null,
          contactLog: [],
          // The evaluation itself is loaded per participant from GET /api/aot/participants/[id].
        };
      });

    const referrals = allRecords
      .filter((p) => p.status === 'referral')
      .map((r) => ({
        id: r.id,
        name: r.name,
        age: r.age > 0 ? r.age : null,
        source: r.referralSource,
        sourceKind: ((r.eligibilityData as any)?.sourceKind as any) || 'family',
        concern: clinical ? r.diagnosis || 'Referral pending screening' : AOT_RESTRICTED_LABEL,
        received: r.createdAt.toISOString().slice(0, 10),
      }));

    const stats = {
      total: caseboard.length,
      activeOrders: caseboard.filter((p) => p.status === 'active' || p.status === 'renewal').length,
      pendingHearing: caseboard.filter((p) => p.status === 'hearing' || p.status === 'petition').length,
      screening: caseboard.filter((p) => p.status === 'screening').length,
      referralsCount: referrals.length,
    };

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'aotParticipant',
      metadata: {
        count: allRecords.length,
        ids: allRecords.slice(0, 50).map((p) => p.id),
        patientIds: linkedIds.slice(0, 50),
        filters: { status: statusParam || null, county: countyParam || null },
      },
    });

    return NextResponse.json({
      success: true,
      caseboard,
      referrals,
      stats,
      statute: 'Maryland Health-General § 10-6A-05 (Assisted Outpatient Treatment)',
    });
  } catch (err: unknown) {
    console.error('[api/aot/caseboard GET] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not fetch AOT caseboard' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ success: false, error: 'Respondent name is required' }, { status: 400 });
    }
    const termProblem = orderTermProblem(body.orderStart, body.orderEnd);
    if (termProblem) {
      return NextResponse.json({ success: false, error: termProblem }, { status: 400 });
    }
    const petitionerIssue = petitionerIssueIn(body.eligibilityData);
    if (petitionerIssue) {
      return NextResponse.json({ success: false, error: petitionerIssue }, { status: 400 });
    }
    const now = new Date();
    const clientId = await clientIdInOrg(body.clientId, gate.organizationId);
    if (clientId === false) {
      return NextResponse.json({ success: false, error: 'Client not found in your organization' }, { status: 404 });
    }

    const created = await prisma.aotParticipant.create({
      data: {
        organizationId: gate.organizationId,
        clientId,
        // Clinical/legal facts are never defaulted: no invented diagnosis, hearing date,
        // hospitalization counts, signed affidavit, or care-team members.
        name: body.name,
        // Column is non-null; 0 means "not recorded" and is returned as null by GET.
        age: Number(body.age) > 0 ? Math.floor(Number(body.age)) : 0,
        status: body.status || 'petition',
        county: body.county || 'Not documented',
        referralSource: body.referralSource || 'Not documented',
        diagnosis: body.diagnosis || 'Not documented — confirm with physician affidavit',
        petitionDate: body.petitionDate ? new Date(body.petitionDate) : null,
        hearingDate: body.hearingDate ? new Date(body.hearingDate) : null,
        orderStart: body.orderStart ? new Date(body.orderStart) : null,
        orderEnd: body.orderEnd ? new Date(body.orderEnd) : null,
        eligibilityData: body.eligibilityData ?? undefined,
        psychiatristAffidavit: body.psychiatristAffidavit ?? undefined,
        deadlines: body.deadlines || [
          {
            id: `dl-${Date.now()}-1`,
            label: 'Physician affidavit — examination & signature',
            due: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
            daysLeft: 7,
            status: 'due',
            basis: 'Altrixs default program target, not statutory. MDH: the psychiatrist "has examined the individual atleast 30 days prior to the petition filing" (timing to be confirmed with counsel). Adjust as needed.',
          },
          {
            id: `dl-${Date.now()}-2`,
            label: 'File petition with court',
            due: new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10),
            daysLeft: 14,
            status: 'upcoming',
            basis: 'Altrixs default program target, not statutory. Adjust as needed.',
          },
          {
            id: `dl-${Date.now()}-3`,
            label: 'Proposed treatment plan drafted',
            due: new Date(now.getTime() + 11 * 86400000).toISOString().slice(0, 10),
            daysLeft: 11,
            status: 'upcoming',
            basis: 'Altrixs default program target, not statutory. Adjust as needed.',
          },
        ],
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

    return NextResponse.json({ success: true, participant: created }, { status: 201 });
  } catch (err: unknown) {
    console.error('[api/aot/caseboard POST] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not create AOT participant' },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();
    const { id, status, hearingDate, complianceTier, deadlines, teamCadence, escalationEvents } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }
    const participant = await findParticipantInOrg(String(id), gate.organizationId);
    if (!participant || !(await participantOnCaseload(gate, participant))) {
      return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    }
    // Non-adherence / escalation events are clinical: EHR clinical roles only
    if (escalationEvents !== undefined && !canSeeAotClinical(gate.role)) {
      return NextResponse.json({ success: false, error: 'Your role cannot change clinical AOT fields' }, { status: 403 });
    }

    const updated = await prisma.aotParticipant.update({
      where: { id },
      data: {
        status: status ?? undefined,
        hearingDate: hearingDate ? new Date(hearingDate) : undefined,
        deadlines: deadlines ?? undefined,
        teamCadence: teamCadence ?? undefined,
        escalationEvents: escalationEvents ?? undefined,
        updatedAt: new Date(),
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'aotParticipant',
      resourceId: updated.id,
      patientId: participant.clientId ?? null,
      metadata: {
        fields: Object.entries({ status, hearingDate, deadlines, teamCadence, escalationEvents })
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k]) => k),
      },
    });

    return NextResponse.json({
      success: true,
      participant: canSeeAotClinical(gate.role)
        ? updated
        : { id: updated.id, name: updated.name, status: updated.status, hearingDate: updated.hearingDate, deadlines: updated.deadlines, teamCadence: updated.teamCadence, clinicalRestricted: true },
      complianceTier,
    });
  } catch (err: unknown) {
    console.error('[api/aot/caseboard PUT] error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not update AOT participant' },
      { status: 500 }
    );
  }
}

