import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/aot')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const countyParam = searchParams.get('county');

    const allRecords = await prisma.aotParticipant.findMany({
      where: {
        ...(statusParam && statusParam !== 'all' ? { status: statusParam } : {}),
        ...(countyParam && countyParam !== 'all' ? { county: countyParam } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

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
        const deadlines = rawDeadlines.map((d) => {
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
            id: d.id || `dl-${Math.random()}`,
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
          age: p.age,
          status: p.status,
          county: p.county,
          referralSource: p.referralSource,
          diagnosis: p.diagnosis,
          petitionDate: p.petitionDate ? p.petitionDate.toISOString().slice(0, 10) : undefined,
          hearingDate: p.hearingDate ? p.hearingDate.toISOString().slice(0, 10) : undefined,
          orderStart: p.orderStart ? p.orderStart.toISOString().slice(0, 10) : undefined,
          orderEnd: p.orderEnd ? p.orderEnd.toISOString().slice(0, 10) : undefined,
          daysUntilHearing,
          daysUntilOrderExpires,
          deadlines,
          team,
          nonAdherence,
          contactLog: [],
        };
      });

    const referrals = allRecords
      .filter((p) => p.status === 'referral')
      .map((r) => ({
        id: r.id,
        name: r.name,
        age: r.age,
        source: r.referralSource,
        sourceKind: ((r.eligibilityData as any)?.sourceKind as any) || 'family',
        concern: r.diagnosis || 'Referral pending screening',
        received: r.createdAt.toISOString().slice(0, 10),
      }));

    const stats = {
      total: caseboard.length,
      activeOrders: caseboard.filter((p) => p.status === 'active' || p.status === 'renewal').length,
      pendingHearing: caseboard.filter((p) => p.status === 'hearing' || p.status === 'petition').length,
      screening: caseboard.filter((p) => p.status === 'screening').length,
      referralsCount: referrals.length,
    };

    return NextResponse.json({
      success: true,
      caseboard,
      referrals,
      stats,
      statute: 'Maryland Health-General § 10-6A-05 (Assisted Outpatient Treatment)',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch AOT caseboard' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/aot')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const now = new Date();

    const created = await prisma.aotParticipant.create({
      data: {
        name: body.name || 'New AOT Participant',
        age: Number(body.age) || 30,
        status: body.status || 'petition',
        county: body.county || 'Baltimore City',
        referralSource: body.referralSource || 'Community Provider Screening (HG § 10-6A-05)',
        diagnosis: body.diagnosis || 'Schizoaffective Disorder (F25.0)',
        petitionDate: body.petitionDate ? new Date(body.petitionDate) : now,
        hearingDate: body.hearingDate ? new Date(body.hearingDate) : new Date(now.getTime() + 14 * 86400000),
        orderStart: body.orderStart ? new Date(body.orderStart) : null,
        orderEnd: body.orderEnd ? new Date(body.orderEnd) : null,
        eligibilityData: body.eligibilityData || {
          statute: 'HG § 10-6A-05',
          prongsMet: true,
          hospitalizationsPast3Years: 2,
          leastRestrictiveAlternativeVerified: true,
        },
        psychiatristAffidavit: body.psychiatristAffidavit || {
          signed: true,
          doctor: 'Dr. S. Obi, MD',
          examinationCompleted: true,
        },
        deadlines: body.deadlines || [
          {
            id: `dl-${Date.now()}-1`,
            label: 'Physician affidavit — examination & signature',
            due: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
            daysLeft: 7,
            status: 'due',
            basis: 'Petition requirement (HG § 10-6A-05)',
          },
          {
            id: `dl-${Date.now()}-2`,
            label: 'File petition with court',
            due: new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10),
            daysLeft: 14,
            status: 'upcoming',
            basis: 'Program standard — file within 14 days of determination',
          },
          {
            id: `dl-${Date.now()}-3`,
            label: 'Proposed treatment plan drafted',
            due: new Date(now.getTime() + 11 * 86400000).toISOString().slice(0, 10),
            daysLeft: 11,
            status: 'upcoming',
            basis: 'Best practice — plan ready at filing',
          },
        ],
        teamCadence: body.teamCadence || [
          { role: 'AOT Coordinator', name: 'R. Bennett, LMSW', cadence: 'Weekly', lastContact: now.toISOString().slice(0, 10), nextDue: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10), status: 'current' },
          { role: 'Psychiatrist (affiant)', name: 'Dr. S. Obi', cadence: 'Pre-filing', lastContact: '—', nextDue: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10), status: 'due' },
        ],
        escalationEvents: body.escalationEvents || [],
      },
    });

    return NextResponse.json({ success: true, participant: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create AOT participant' },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/aot')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id, status, hearingDate, complianceTier, deadlines, teamCadence, escalationEvents } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
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

    return NextResponse.json({ success: true, participant: updated, complianceTier });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update AOT participant' },
      { status: 500 }
    );
  }
}

