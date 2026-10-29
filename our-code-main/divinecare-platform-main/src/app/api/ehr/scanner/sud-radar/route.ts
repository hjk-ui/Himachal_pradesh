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
  if (!canAccessPath(gate.role, '/dashboard/ehr/scanner')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get('source');

    let signals = await prisma.sudRadarSignal.findMany({
      where: {
        ...(source && source !== 'all' ? { detectionSource: source } : {}),
      },
      include: {
        client: { select: { id: true, name: true, mrn: true } },
      },
      orderBy: { scannedAt: 'desc' },
    });

    const totalCount = signals.length;
    const diagnosisCount = signals.filter((s) => s.detectionSource === 'diagnosis').length;
    const keywordCount = signals.filter((s) => s.detectionSource === 'note-keyword').length;

    return NextResponse.json({
      success: true,
      signals,
      stats: {
        total: totalCount,
        diagnosis: diagnosisCount,
        keyword: keywordCount,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch SUD radar signals' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/scanner')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const signal = await prisma.sudRadarSignal.create({
      data: {
        organizationId: gate.organizationId,
        clientId: body.clientId,
        detectionSource: body.detectionSource || 'note-keyword',
        detectedCondition: body.detectedCondition,
        quotedEvidence: body.quotedEvidence,
        confidencePercent: Number(body.confidencePercent) || 85,
        recommendation: body.recommendation,
        actionLabel: body.actionLabel || 'Review Record',
        actionHref: body.actionHref || '/dashboard/ehr/assessments/sud',
      },
    });

    return NextResponse.json({ success: true, signal }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save radar signal' },
      { status: 500 }
    );
  }
}
