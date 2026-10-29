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
    const status = searchParams.get('status');
    const county = searchParams.get('county');

    let participants = await prisma.aotParticipant.findMany({
      where: {
        ...(status && status !== 'all' ? { status } : {}),
        ...(county && county !== 'all' ? { county } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, participants });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch AOT participants' },
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

    // Maryland Health-General § 10-6A-05 Statutory Guard: 30-day Exam Window
    if (body.psychiatristAffidavit && body.psychiatristAffidavit.examDate) {
      const examDate = new Date(body.psychiatristAffidavit.examDate).getTime();
      const filingDate = body.petitionDate ? new Date(body.petitionDate).getTime() : Date.now();
      const diffDays = Math.floor((filingDate - examDate) / (1000 * 60 * 60 * 24));

      if (diffDays > 30) {
        return NextResponse.json(
          {
            success: false,
            error: `Maryland HG § 10-6A-05 Statutory Hard Stop: Psychiatric examination is ${diffDays} days old (>30 days). Court petition requires an updated clinical examination.`,
            gate: 'AOT_EXAM_WINDOW_EXPIRED',
          },
          { status: 422 }
        );
      }
    }

    const created = await prisma.aotParticipant.create({
      data: {
        name: body.name || 'Respondent Candidate',
        clientId: body.clientId || null,
        age: body.age ? Number(body.age) : 30,
        status: body.status || 'screening',
        county: body.county || 'Baltimore City',
        referralSource: body.referralSource || 'Hospital Liaison / Crisis Referral',
        diagnosis: body.diagnosis || 'Severe Mental Illness (SMI)',
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

    return NextResponse.json({ success: true, participant: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create AOT participant' },
      { status: 500 }
    );
  }
}
