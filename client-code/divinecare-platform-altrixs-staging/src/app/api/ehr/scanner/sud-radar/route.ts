import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import {
  assertClientPhiAccess,
  lockedSensitiveClientIds,
  SensitiveRecordAccessError,
} from '@/lib/privacy/sensitiveAccess';
import { resolveSudAlertRecipient } from '@/lib/ehr/sudRecipient';
import { canUseSudRadar, SUD_RADAR_PATH } from '@/lib/clinical/sudRadar/access';
import { serverTiming } from '@/lib/perf/cache';
import { openMeasuresFor } from '@/lib/clinical/sudRadar/assignMeasures';
import { practiceSudRadarAutoAssign } from '@/lib/practice/consumers';

export const runtime = 'nodejs';

const STATUSES = ['new', 'reviewed', 'referred', 'dismissed', 'resolved'] as const;

function scopeFor(gate: { organizationId: string; userId: string; role: Parameters<typeof clientAccessWhere>[0]['actorRole'] }) {
  // Caseload roles only see their assigned clients.
  return clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseSudRadar(gate.role, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get('source');
    // Resolved signals are history: hidden unless asked for (status=resolved or status=all)
    const status = searchParams.get('status');
    const statusWhere =
      status === 'all'
        ? {}
        : status && (STATUSES as readonly string[]).includes(status)
          ? { status }
          : { status: { not: 'resolved' } };

    const timing = serverTiming();
    const signalRows = await timing.time('signals', () => prisma.sudRadarSignal.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(source && source !== 'all' ? { detectionSource: source } : {}),
        ...statusWhere,
        client: scopeFor(gate),
      },
      include: {
        client: {
          select: { id: true, name: true, mrn: true, assignedToId: true, assignedTo: { select: { id: true, name: true } } },
        },
      },
      orderBy: { scannedAt: 'desc' },
      take: 2000,
    }));

    // Part 2: hide protected (sensitive) clients without whitelist / break-glass access.
    const locked = await timing.time('part2', () => lockedSensitiveClientIds({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientIds: signalRows.map((s) => s.clientId),
    }));
    const signals = signalRows.filter((s) => !locked.has(s.clientId));
    const sensitiveHidden = signalRows.length - signals.length;
    // Measures already on the MBC schedule (open), so the radar shows them and the dialog skips them
    const [openMeasures, autoAssignMeasures] = await Promise.all([
      openMeasuresFor(gate.organizationId, [...new Set(signals.map((s) => s.clientId))]).catch((err: unknown) => {
        console.error('[ehr/scanner/sud-radar GET] open measures failed:', err instanceof Error ? err.message : 'unknown error');
        return {} as Record<string, string[]>;
      }),
      practiceSudRadarAutoAssign(gate.organizationId),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of signals) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    const lastScan = signals.reduce<Date | null>((max, s) => (s.lastSeenAt && (!max || s.lastSeenAt > max) ? s.lastSeenAt : max), null);

    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'sudRadarSignal',
      metadata: { count: signals.length, source: source || 'all', status: status || 'open', sensitiveHidden },
    });

    return NextResponse.json({
      success: true,
      signals,
      openMeasures,
      autoAssignMeasures,
      stats: {
        total: signals.length,
        diagnosis: signals.filter((s) => s.detectionSource === 'diagnosis').length,
        keyword: signals.filter((s) => s.detectionSource === 'note-keyword').length,
        byStatus,
        sensitiveHidden,
        lastScanAt: lastScan ? lastScan.toISOString() : null,
      },
    }, { headers: { 'Server-Timing': timing.header(), 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    console.error('[ehr/scanner/sud-radar GET] error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json(
      { success: false, error: 'Could not fetch SUD radar signals' },
      { status: 500 }
    );
  }
}

const signalSchema = z.object({
  clientId: z.string().min(1),
  detectionSource: z.enum(['diagnosis', 'note-keyword']).optional(),
  detectedCondition: z.string().trim().min(1).max(500),
  quotedEvidence: z.string().max(5000).optional().default(''),
  confidencePercent: z.coerce.number().min(0).max(100),
  recommendation: z.string().max(2000).optional().default(''),
  actionLabel: z.string().max(120).optional(),
  actionHref: z.string().startsWith('/dashboard/').max(300).optional(),
});

/** Hand-saved signal (kept for clinicians recording a finding; the scan never resolves these). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseSudRadar(gate.role, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const parsed = signalSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid signal' }, { status: 400 });
    }
    const body = parsed.data;
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, ...scopeFor(gate) },
      select: { id: true },
    });
    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'sudRadarSignal', patientId: body.clientId,
        outcome: 'DENIED', metadata: { reason: 'client_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
    try {
      await assertClientPhiAccess({
        organizationId: gate.organizationId, userId: gate.userId, role: gate.role,
        clientId: client.id, path: SUD_RADAR_PATH,
      });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) {
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'sudRadarSignal', patientId: client.id,
          outcome: 'DENIED', metadata: { reason: 'sensitive_record' },
        });
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
    const signal = await prisma.sudRadarSignal.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        detectionSource: body.detectionSource || 'note-keyword',
        detectedCondition: body.detectedCondition,
        quotedEvidence: body.quotedEvidence,
        confidencePercent: Math.round(body.confidencePercent),
        recommendation: body.recommendation,
        actionLabel: body.actionLabel || 'Review Record',
        actionHref: body.actionHref || '/dashboard/ehr/assessments/sud',
      },
    });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'sudRadarSignal', resourceId: signal.id, patientId: client.id,
      metadata: { detectionSource: signal.detectionSource },
    });
    return NextResponse.json({ success: true, signal }, { status: 201 });
  } catch (err: unknown) {
    console.error('[ehr/scanner/sud-radar POST] error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json(
      { success: false, error: 'Could not save radar signal' },
      { status: 500 }
    );
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ id: z.string().min(1), action: z.literal('review') }),
  z.object({ id: z.string().min(1), action: z.literal('reopen') }),
  z.object({ id: z.string().min(1), action: z.literal('dismiss'), reason: z.string().trim().min(3).max(500) }),
  z.object({ id: z.string().min(1), action: z.literal('refer') }),
]);

/**
 * Clinician action on a signal: mark reviewed, dismiss (reason required), reopen, or refer —
 * which creates the existing SUD_REFERRAL_PROMPT alert routed to the treatment-team prescriber
 * (assigned clinician fallback), shown as the "SUD Referral Review" To-Do.
 */
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseSudRadar(gate.role, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid action (dismissing needs a reason)' }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const signal = await prisma.sudRadarSignal.findFirst({
      where: { id: body.id, organizationId: gate.organizationId, client: scopeFor(gate) },
      include: { client: { select: { id: true, name: true, assignedTo: { select: { id: true, name: true, role: true } } } } },
    });
    if (!signal) {
      await auditPhiAccess({
        gate, req, action: 'UPDATE', resourceType: 'sudRadarSignal', resourceId: body.id,
        outcome: 'DENIED', metadata: { operation: body.action, reason: 'signal_not_found' },
      });
      return NextResponse.json({ success: false, error: 'Signal not found' }, { status: 404 });
    }
    try {
      await assertClientPhiAccess({
        organizationId: gate.organizationId, userId: gate.userId, role: gate.role,
        clientId: signal.clientId, path: SUD_RADAR_PATH,
      });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) {
        await auditPhiAccess({
          gate, req, action: 'UPDATE', resourceType: 'sudRadarSignal', resourceId: signal.id, patientId: signal.clientId,
          outcome: 'DENIED', metadata: { operation: body.action, reason: 'sensitive_record' },
        });
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }

    const now = new Date();
    const stamp = { statusChangedAt: now, statusChangedById: gate.userId };

    if (body.action === 'refer') {
      if (signal.routedAction === 'tobacco-cessation') {
        return NextResponse.json(
          { success: false, error: 'Tobacco (F17) signals are not routed for SUD referral — document a cessation note instead.' },
          { status: 400 }
        );
      }
      // Idempotent: an open referral alert for this signal is returned, not duplicated
      if (signal.referralAlertId) {
        const open = await prisma.riskAlert.findFirst({
          where: { id: signal.referralAlertId, organizationId: gate.organizationId, reviewed: false },
          select: { id: true },
        });
        if (open) {
          return NextResponse.json({ success: true, alreadyReferred: true, alertId: open.id });
        }
      }
      const recipient = await resolveSudAlertRecipient({
        organizationId: gate.organizationId,
        clientId: signal.clientId,
        assignedTo: signal.client.assignedTo,
      });
      const alert = await prisma.riskAlert.create({
        data: {
          organizationId: gate.organizationId,
          clientId: signal.clientId,
          clientName: signal.client.name,
          type: 'SUD_REFERRAL_PROMPT',
          severity: signal.routedAction === 'residential-referral' ? 'HIGH' : 'MEDIUM',
          description: `SUD Referral Radar (${signal.detectionSource === 'diagnosis' ? 'diagnosis codes' : 'note language'}): ${signal.detectedCondition}. Prescriber review for ASAM level-of-care / residential or IOP referral.`.slice(0, 1000),
          source: 'sud-radar',
          sourceId: signal.id,
          clinicianId: recipient?.userId ?? null,
        },
      });
      await prisma.sudRadarSignal.update({
        where: { id: signal.id },
        data: { status: 'referred', referralAlertId: alert.id, statusReason: null, ...stamp },
      });
      await auditPhiAccess({
        gate, req, action: 'UPDATE', resourceType: 'sudRadarSignal', resourceId: signal.id, patientId: signal.clientId,
        metadata: { operation: 'refer', riskAlertId: alert.id, routed: Boolean(recipient), recipientSource: recipient?.source ?? null },
      });
      return NextResponse.json({ success: true, alertId: alert.id, recipient });
    }

    const next =
      body.action === 'review'
        ? { status: 'reviewed', statusReason: null }
        : body.action === 'dismiss'
          ? { status: 'dismissed', statusReason: body.reason }
          : { status: 'new', statusReason: null };
    const updated = await prisma.sudRadarSignal.update({
      where: { id: signal.id },
      data: { ...next, ...stamp },
      select: { id: true, status: true, statusReason: true, statusChangedAt: true },
    });
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'sudRadarSignal', resourceId: signal.id, patientId: signal.clientId,
      metadata: { operation: body.action, status: updated.status },
    });
    return NextResponse.json({ success: true, signal: updated });
  } catch (err: unknown) {
    console.error('[ehr/scanner/sud-radar PATCH] error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not update the signal' }, { status: 500 });
  }
}
