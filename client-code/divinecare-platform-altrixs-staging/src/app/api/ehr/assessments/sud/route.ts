import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import {
  assertClientPhiAccess,
  lockedSensitiveClientIds,
  SensitiveRecordAccessError,
} from '@/lib/privacy/sensitiveAccess';
import { resolveSudAlertRecipient, sudRoleLabel } from '@/lib/ehr/sudRecipient';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const SUD_PATH = '/dashboard/ehr/assessments/sud';

// 42 CFR Part 2: SUD screenings are limited to clinical EHR roles.
function canUseSudScreening(role: string | null | undefined): boolean {
  return canAccessPath(role, '/dashboard/ehr') || canAccessPath(role, '/dashboard/ehr/assessments');
}

type SudGate = {
  organizationId: string;
  userId: string;
  role: Parameters<typeof clientAccessWhere>[0]['actorRole'];
};

/** Org scope; caseload roles only see their assigned clients. */
function sudClientScope(gate: SudGate) {
  return clientAccessWhere({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
  });
}

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
  if (!canUseSudScreening(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'sudScreening',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden — clinical role required for 42 CFR Part 2 assessments' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const recipientFor = searchParams.get('recipientFor');

  // Preview who a referral alert for this client would be routed to.
  if (recipientFor) {
    try {
      const client = await prisma.client.findFirst({
        where: { id: recipientFor, ...sudClientScope(gate) },
        select: { id: true, assignedTo: { select: { id: true, name: true, role: true } } },
      });
      if (!client) {
        await auditPhiAccess({
          gate, req, action: 'READ', resourceType: 'sudAlertRecipient', patientId: recipientFor,
          outcome: 'DENIED', metadata: { reason: 'client_not_found' },
        });
        return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
      }
      const recipient = await resolveSudAlertRecipient({
        organizationId: gate.organizationId,
        clientId: client.id,
        assignedTo: client.assignedTo,
      });
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'sudAlertRecipient', resourceId: client.id, patientId: client.id,
        metadata: { resolved: Boolean(recipient) },
      });
      return NextResponse.json({ success: true, recipient });
    } catch {
      console.error('[sud-screening GET recipient] lookup failed');
      return NextResponse.json({ success: false, error: 'Failed to resolve alert recipient' }, { status: 500 });
    }
  }

  try {
    if (clientId) {
      // Part 2 sensitive-record rules (whitelist / break-glass) for a single chart.
      try {
        await assertClientPhiAccess({
          organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientId, path: SUD_PATH,
        });
      } catch (err) {
        if (err instanceof SensitiveRecordAccessError) {
          await auditPhiAccess({
            gate, req, action: 'LIST', resourceType: 'sudScreening', patientId: clientId,
            outcome: 'DENIED', metadata: { reason: 'sensitive_record' },
          });
          return NextResponse.json(err.body, { status: err.status });
        }
        throw err;
      }
    }

    const scope = sudClientScope(gate);
    const screeningRows = await prisma.sudScreening.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(clientId ? { clientId } : {}),
        client: scope,
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

    const alertRows = await prisma.riskAlert.findMany({
      where: {
        organizationId: gate.organizationId,
        type: 'SUD_REFERRAL_PROMPT',
        client: scope,
      },
      include: { clinician: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Drop rows for protected (sensitive) clients this user has no whitelist / break-glass for.
    const locked = await lockedSensitiveClientIds({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientIds: [...screeningRows.map((s) => s.clientId), ...alertRows.map((a) => a.clientId)],
    });
    const screenings = screeningRows.filter((s) => !locked.has(s.clientId));
    const recentAlerts = alertRows.filter((a) => !locked.has(a.clientId));

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'sudScreening', patientId: clientId || null,
      metadata: {
        count: screenings.length,
        routedAlertCount: recentAlerts.length,
        clientId: clientId || null,
        sensitiveHidden: screeningRows.length - screenings.length + (alertRows.length - recentAlerts.length),
      },
    });

    return NextResponse.json({
      success: true,
      screenings,
      routedAlerts: recentAlerts.map((a) => ({
        id: a.id,
        client: a.clientName || 'Client',
        prescriber: a.clinician
          ? `${a.clinician.name || 'Clinician'} (${sudRoleLabel(a.clinician.role)})`
          : 'Unassigned — general Alerts queue',
        tool: a.source === 'sud-radar' ? 'SUD Referral Radar' : a.sourceId || 'SUD Screener',
        score: a.description || 'Positive',
        trigger: a.description || 'Threshold hit',
        time: a.createdAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    console.error('[sud-screening GET] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to query screenings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // 42 CFR Part 2 and Clinical role gate
  if (!canUseSudScreening(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden — clinical role required for 42 CFR Part 2 assessments' }, { status: 403 });
  }

  try {
    const body = sudSubmitSchema.parse(await req.json());

    // Verify client belongs to organization
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, ...sudClientScope(gate) },
      include: { assignedTo: { select: { id: true, name: true, role: true } } },
    });

    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'sudScreening', patientId: body.clientId,
        outcome: 'DENIED', metadata: { tool: body.tool, reason: 'client_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    try {
      await assertClientPhiAccess({
        organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientId: client.id, path: SUD_PATH,
      });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'sudScreening', patientId: client.id,
          outcome: 'DENIED', metadata: { tool: body.tool, reason: 'sensitive_record' },
        });
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
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

    // Route to the treatment team's prescriber; fall back to the assigned clinician.
    const recipient = await resolveSudAlertRecipient({
      organizationId: gate.organizationId,
      clientId: client.id,
      assignedTo: client.assignedTo,
    });
    const prescriberId = recipient?.userId ?? null;
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

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'sudScreening', resourceId: screening.id, patientId: client.id,
      metadata: {
        tool: body.tool,
        riskLevel,
        signed: body.sign,
        alertRouted: body.routeAlert,
        riskAlertId: createdAlert?.id ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        screening,
        alert: createdAlert,
        recipient,
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    console.error('[sud-screening POST] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save SUD screening' }, { status: 500 });
  }
}

const sudSignSchema = z.object({
  id: z.string().min(1),
  sign: z.literal(true),
});

// Signs a screening that was saved unsigned when its referral alert was routed.
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseSudScreening(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden — clinical role required for 42 CFR Part 2 assessments' }, { status: 403 });
  }

  const parsed = sudSignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid body: id and sign: true required' }, { status: 400 });
  }

  try {
    const screening = await prisma.sudScreening.findFirst({
      where: { id: parsed.data.id, organizationId: gate.organizationId, client: sudClientScope(gate) },
      select: { id: true, clientId: true, signed: true, riskLevel: true, alertRouted: true },
    });
    if (!screening) {
      await auditPhiAccess({
        gate, req, action: 'WRITE', resourceType: 'sudScreening', resourceId: parsed.data.id,
        outcome: 'DENIED', metadata: { operation: 'sign', reason: 'screening_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Screening not found' }, { status: 404 });
    }
    try {
      await assertClientPhiAccess({
        organizationId: gate.organizationId, userId: gate.userId, role: gate.role,
        clientId: screening.clientId, path: SUD_PATH,
      });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) {
        await auditPhiAccess({
          gate, req, action: 'UPDATE', resourceType: 'sudScreening', resourceId: screening.id,
          patientId: screening.clientId, outcome: 'DENIED', metadata: { operation: 'sign', reason: 'sensitive_record' },
        });
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
    if (screening.riskLevel !== 'NEGATIVE' && !screening.alertRouted) {
      return NextResponse.json(
        { success: false, error: 'Positive SUD screens cannot be signed without a routed referral alert.' },
        { status: 400 }
      );
    }
    if (screening.signed) {
      return NextResponse.json({ success: true, data: { screening } });
    }

    const now = new Date();
    const updated = await prisma.sudScreening.update({
      where: { id: screening.id },
      data: { signed: true, signedAt: now, signedById: gate.userId },
    });
    await auditPhiAccess({
      gate, req, action: 'WRITE', resourceType: 'sudScreening', resourceId: updated.id, patientId: updated.clientId,
      metadata: { operation: 'sign', fields: ['signed', 'signedAt', 'signedById'] },
    });
    return NextResponse.json({ success: true, data: { screening: updated } });
  } catch (error: unknown) {
    console.error('[sud-screening PATCH]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Failed to sign SUD screening' }, { status: 500 });
  }
}
