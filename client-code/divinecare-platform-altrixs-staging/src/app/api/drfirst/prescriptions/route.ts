import { NextRequest, NextResponse } from 'next/server';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canViewPrescriptions } from '@/lib/prescriptions/access';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';

export const dynamic = 'force-dynamic';

const LIMIT = 500;

/**
 * GET /api/drfirst/prescriptions — the e-prescribing worklist, read only from the tables the
 * DrFirst download sweep writes (update_prescription, update_prescription_events, update_notification,
 * update_rxchange; cron every 15 min). Prescriptions are written, signed, renewed and changed in
 * Rcopia; Altrixs never marks anything as sent.
 *
 * PDM1: the prescription list is separate from the medication list.
 * PDR1: pending (not yet signed / sent) prescriptions are returned with their own lifecycle status.
 * Scope: the caller's organization and caseload (clientAccessWhere), same rule as the client roster;
 * rows for 42 CFR Part 2 / sensitive clients the caller may not open are dropped (lockedSensitiveClientIds).
 */
export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const role = String(gate.role);
  if (!canViewPrescriptions(role)) {
    return NextResponse.json({ error: 'You do not have access to e-prescribing.' }, { status: 403 });
  }

  const client: Prisma.ClientWhereInput = clientAccessWhere({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: role as Role,
  });
  const clientSelect = { select: { id: true, name: true, mrn: true } } as const;

  try {
    const [allPrescriptions, allRenewals, allChanges, cursors, lastSync, lastErrors] = await Promise.all([
      prisma.rcopiaPrescription.findMany({
        where: { client },
        orderBy: [{ createdDate: 'desc' }, { createdAt: 'desc' }],
        take: LIMIT,
        select: {
          id: true, rcopiaId: true, clientId: true, client: clientSelect,
          providerName: true, providerNpi: true, supervisorName: true,
          drugName: true, schedule: true, sig: true, quantity: true, refills: true,
          pharmacyName: true, lifecycleStatus: true, createdDate: true, signedDate: true, stopDate: true,
        },
      }),
      prisma.rcopiaRefillNotification.findMany({
        where: { client },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true, clientId: true, client: clientSelect, providerUsername: true,
          drugPrescribed: true, drugDispensed: true, pharmacyName: true, actionTaken: true, createdAt: true,
        },
      }),
      prisma.rcopiaRxchangeRequest.findMany({
        where: { client },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true, clientId: true, client: clientSelect, orderedDrugName: true, requestedDrugName: true,
          requestType: true, changeReason: true, priorAuthNumber: true, status: true, createdAt: true,
        },
      }),
      prisma.drFirstSyncCursor.findMany({ select: { commandName: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 1 }),
      prisma.drFirstApiLog.findFirst({
        where: { kind: 'api', command: { startsWith: 'update_' }, ok: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.drFirstApiLog.findMany({
        where: { kind: 'api', ok: false, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { command: true, errorCode: true, createdAt: true },
      }),
    ]);

    const locked = await lockedSensitiveClientIds({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role,
      clientIds: [...allPrescriptions, ...allRenewals, ...allChanges].map((r) => r.clientId),
    });
    const prescriptions = allPrescriptions.filter((r) => !locked.has(r.clientId));
    const renewals = allRenewals.filter((r) => !locked.has(r.clientId));
    const changes = allChanges.filter((r) => !locked.has(r.clientId));

    // Latest pharmacy fill status per prescription (update_prescription_events / RxFill)
    const rxIds = prescriptions.map(p => p.rcopiaId);
    const fills = rxIds.length
      ? await prisma.rcopiaRxfillEvent.findMany({
          where: { prescriptionRcopiaId: { in: rxIds } },
          orderBy: { fillDate: 'desc' },
          select: { prescriptionRcopiaId: true, fillStatus: true, fillDate: true },
        })
      : [];
    const latestFill = new Map<string, { status: string; date: Date }>();
    for (const f of fills) {
      if (!latestFill.has(f.prescriptionRcopiaId)) latestFill.set(f.prescriptionRcopiaId, { status: f.fillStatus, date: f.fillDate });
    }

    const name = (c: { name: string } | null) => c?.name?.trim() || 'Unknown patient';

    await writeAuditLog({
      action: 'READ',
      actorUserId: gate.userId,
      actorRole: role,
      organizationId: gate.organizationId,
      resourceType: 'prescription',
      resourceId: 'drfirst-prescription-worklist',
      ...auditRequestMeta(req),
      metadata: { prescriptions: prescriptions.length, renewals: renewals.length, changes: changes.length, sensitiveHidden: locked.size },
    });

    const syncedAt = [cursors[0]?.updatedAt, lastSync?.createdAt].filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null;

    return NextResponse.json({
      success: true,
      data: {
        connected: !DEMO_MODE,
        syncedAt,
        recentErrors: lastErrors,
        truncated: allPrescriptions.length === LIMIT,
        prescriptions: prescriptions.map(({ client: c, ...p }) => ({
          ...p,
          patientName: name(c),
          mrn: c?.mrn ?? null,
          fill: latestFill.get(p.rcopiaId) ?? null,
        })),
        renewals: renewals.map(({ client: c, ...r }) => ({ ...r, patientName: name(c), mrn: c?.mrn ?? null })),
        changes: changes.map(({ client: c, ...r }) => ({ ...r, patientName: name(c), mrn: c?.mrn ?? null })),
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    console.error('[drfirst-prescriptions] error:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Failed to load prescriptions' }, { status: 500 });
  }
}
