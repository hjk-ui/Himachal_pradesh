import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const sudSubmitSchema = z.object({
  clientId: z.string().min(1),
  tool: z.enum(['AUDIT', 'CAGE_AID', 'NIDA', 'BAM']),
  answers: z.any(),
  routeAlert: z.boolean().default(false),
  sign: z.boolean().default(false),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  try {
    const screenings = await prisma.sudScreening.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(clientId ? { clientId } : {}),
      },
      include: {
        client: {
          select: { id: true, name: true, assignedToId: true, assignedTo: { select: { id: true, name: true, role: true } } },
        },
        alerts: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const recentAlerts = await prisma.riskAlert.findMany({
      where: {
        organizationId: gate.organizationId,
        type: 'SUD_REFERRAL_PROMPT',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      screenings,
      routedAlerts: recentAlerts.map((a) => ({
        id: a.id,
        client: a.clientName || 'Client',
        prescriber: 'Assigned Prescriber',
        tool: a.sourceId || 'SUD Screener',
        score: a.description || 'Positive',
        trigger: a.description || 'Threshold hit',
        time: a.createdAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to query screenings';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // 42 CFR Part 2 and Clinical role gate
  if (!canAccessPath(gate.role, '/dashboard/ehr') && !canAccessPath(gate.role, '/dashboard/ehr/assessments')) {
    return NextResponse.json({ success: false, error: 'Forbidden — clinical role required for 42 CFR Part 2 assessments' }, { status: 403 });
  }

  try {
    const body = sudSubmitSchema.parse(await req.json());

    // Verify client belongs to organization
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, organizationId: gate.organizationId },
      include: { assignedTo: { select: { id: true, name: true, role: true } } },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    // Scoring & trigger evaluation
    let totalScore = '';
    let riskLevel: 'NEGATIVE' | 'POSITIVE' | 'HIGH_RISK' = 'NEGATIVE';
    let triggerRationale = '';

    if (body.tool === 'AUDIT') {
      const answers = Array.isArray(body.answers) ? body.answers : [];
      const total = answers.reduce((sum: number, val: any) => sum + (Number(val) || 0), 0);
      totalScore = `${total} / 40`;
      if (total >= 15) {
        riskLevel = 'HIGH_RISK';
        triggerRationale = 'High risk (AUDIT >= 15) — assess for dependence; consider ASAM level-of-care evaluation';
      } else if (total >= 8) {
        riskLevel = 'POSITIVE';
        triggerRationale = 'Positive screen (AUDIT >= 8) — brief intervention; prescriber review for SUD referral';
      } else {
        riskLevel = 'NEGATIVE';
        triggerRationale = 'Below threshold — reinforce and rescreen per protocol';
      }
    } else if (body.tool === 'CAGE_AID') {
      const answers = Array.isArray(body.answers) ? body.answers : [];
      const yesCount = answers.filter((a: any) => a === true || a === 1 || a === 'true').length;
      totalScore = `${yesCount} / 4`;
      if (yesCount >= 2) {
        riskLevel = 'POSITIVE';
        triggerRationale = 'Positive screen (CAGE-AID >= 2) — brief intervention; prescriber review for SUD referral';
      } else if (yesCount === 1) {
        riskLevel = 'NEGATIVE';
        triggerRationale = 'One positive response — below threshold, but follow up with AUDIT or NIDA Quick Screen';
      } else {
        riskLevel = 'NEGATIVE';
        triggerRationale = 'Below threshold — rescreen per protocol';
      }
    } else if (body.tool === 'NIDA') {
      const answers = Array.isArray(body.answers) ? body.answers : [];
      const drugUse = (Number(answers[2]) || 0) > 0 || (Number(answers[3]) || 0) > 0;
      const heavyAlcohol = (Number(answers[0]) || 0) > 0;
      if (drugUse) {
        riskLevel = 'HIGH_RISK';
        totalScore = 'Drug use endorsed';
        triggerRationale = 'Drug use endorsed — administer full NIDA-Modified ASSIST; prescriber review for SUD referral';
      } else if (heavyAlcohol) {
        riskLevel = 'POSITIVE';
        totalScore = 'Heavy-drinking days endorsed';
        triggerRationale = 'Heavy-drinking days endorsed — administer AUDIT';
      } else {
        riskLevel = 'NEGATIVE';
        totalScore = 'All negative';
        triggerRationale = 'Below threshold — rescreen annually';
      }
    } else if (body.tool === 'BAM') {
      const bam = typeof body.answers === 'object' && body.answers !== null ? body.answers : {};
      const alcDays = Number(bam.alcoholDays) || 0;
      const hvyDays = Number(bam.heavyDays) || 0;
      const drgDays = Number(bam.drugDays) || 0;
      const craving = Number(bam.craving) || 0;
      totalScore = `${alcDays}d alcohol · ${hvyDays}d heavy · ${drgDays}d drugs · craving ${craving}/4`;

      if (hvyDays > 0 || drgDays > 0) {
        riskLevel = 'HIGH_RISK';
        triggerRationale = 'Heavy drinking or drug use days reported — prescriber review; reassess level of care';
      } else if (alcDays > 0 || craving >= 3) {
        riskLevel = 'POSITIVE';
        triggerRationale = 'Use or elevated craving reported — prescriber review; adjust treatment plan';
      } else {
        riskLevel = 'NEGATIVE';
        triggerRationale = 'Stable — continue monitoring cadence';
      }
    }

    // MANDATORY GUARDRAIL: Positive screens cannot be filed without routing the alert
    if (riskLevel !== 'NEGATIVE' && body.sign && !body.routeAlert) {
      return NextResponse.json(
        {
          success: false,
          error: 'Positive SUD screens cannot be filed without routing an alert to the assigned prescriber. Route the referral alert before signing.',
        },
        { status: 400 }
      );
    }

    const prescriberId = client.assignedToId || null;
    const now = new Date();

    // 1. Create the SUD screening record
    const screening = await prisma.sudScreening.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        prescriberId,
        administeredById: gate.userId,
        tool: body.tool,
        answers: body.answers,
        totalScore,
        riskLevel,
        triggerRationale,
        alertRouted: body.routeAlert,
        alertRoutedAt: body.routeAlert ? now : null,
        signed: body.sign,
        signedAt: body.sign ? now : null,
        signedById: body.sign ? gate.userId : null,
      },
    });

    // 2. If alert is routed, create RiskAlert
    let createdAlert = null;
    if (body.routeAlert && riskLevel !== 'NEGATIVE') {
      createdAlert = await prisma.riskAlert.create({
        data: {
          organizationId: gate.organizationId,
          clientId: client.id,
          clientName: client.name,
          type: 'SUD_REFERRAL_PROMPT',
          severity: riskLevel === 'HIGH_RISK' ? 'HIGH' : 'MEDIUM',
          description: `${body.tool} (${totalScore}): ${triggerRationale}`,
          source: 'assessment',
          sourceId: screening.id,
          screeningId: screening.id,
          clinicianId: prescriberId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        screening,
        alert: createdAlert,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Failed to save SUD screening';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
