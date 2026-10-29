import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { PRP_LOCUS_MIN, TMS_DEFAULT_MIN_TRIALS } from '@/lib/clinical/serviceEligibility/criteria';
import { PROGRAMS } from '@/lib/clinical/serviceEligibility/types';
import { loadScannerRows, runAndStoreScan, ScanBusyError, type StoredScan } from '@/lib/clinical/serviceEligibility/snapshot';
import { decorateRows, scanScopeFor, SERVICE_SCANNER_PATH } from '@/lib/clinical/serviceEligibility/server';
import { conversion, tileCounts, DEFAULT_FILTERS } from '@/lib/clinical/serviceEligibility/view';
import { serverTiming } from '@/lib/perf/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/ehr/scanner/service-eligibility — the Service Eligibility Scanner worklist for the
 * viewer's scope (org-wide for leadership; assigned / care-team clients for caseload roles),
 * read from the precomputed snapshot (nightly scan: scripts/service-eligibility-scan.ts).
 * ?refresh=1 re-scans the viewer's scope now and stores it (one scan per org at a time — a Postgres
 * advisory lock; a busy scan returns the current snapshot with scanBusy). The first visit before
 * any snapshot exists scans once. Protected records the viewer cannot open are left out and
 * counted. Rows carry statuses only; criteria and evidence load per client
 * (GET /api/ehr/scanner/service-eligibility/[clientId]). Every read is audited (counts only).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, SERVICE_SCANNER_PATH, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const timing = serverTiming();
    const refresh = new URL(req.url).searchParams.get('refresh') === '1';
    const clientWhere = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    const lockedIds = (clientIds: string[]) =>
      lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds });

    const hasSnapshot = refresh
      ? true
      : Boolean(await prisma.serviceEligibilitySnapshot.findFirst({ where: { organizationId: gate.organizationId }, select: { clientId: true } }));
    let stored: StoredScan | null = null;
    let scanBusy = false;
    if (refresh || !hasSnapshot) {
      try {
        const timeZone = await getPracticeTimeZone(gate.organizationId);
        stored = await timing.time('scan', () =>
          runAndStoreScan({
            organizationId: gate.organizationId,
            clientWhere,
            lockedIds,
            trigger: 'manual',
            scope: scanScopeFor(gate.role, gate),
            actorUserId: gate.userId,
            timeZone,
          })
        );
        await auditPhiAccess({
          gate, req, action: 'CREATE', resourceType: 'serviceEligibilityScan', resourceId: stored.runId,
          metadata: { trigger: refresh ? 'manual' : 'first-visit', scope: scanScopeFor(gate.role, gate), durationMs: stored.durationMs, clientsScanned: stored.scan.clientsScanned, sensitiveHidden: stored.scan.sensitiveHidden },
        });
      } catch (err) {
        if (!(err instanceof ScanBusyError)) throw err;
        scanBusy = true;
      }
    }

    const read = await timing.time('read', () => loadScannerRows({ organizationId: gate.organizationId, clientWhere, lockedIds }));
    const rows = await timing.time('decorate', () => decorateRows(gate.organizationId, read.rows));

    const clinicians = new Map<string, string>();
    const locations = new Map<string, string>();
    for (const c of rows) {
      if (c.clinician) clinicians.set(c.clinician.id, c.clinician.name);
      if (c.location) locations.set(c.location.id, c.location.name);
    }
    const counts = tileCounts(rows, { ...DEFAULT_FILTERS, workflow: 'all', tier: 'all' }, new Date());
    const byProgram: Record<string, Record<string, number>> = {};
    for (const p of PROGRAMS) byProgram[p] = { ...counts[p] };
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'serviceEligibilityScan',
      metadata: {
        source: stored ? 'scan' : 'snapshot',
        clientsInScope: read.clientsInScope,
        clientsReturned: rows.length,
        notScanned: read.notScanned,
        sensitiveHidden: read.sensitiveHidden,
        counts: JSON.stringify(byProgram),
      },
    });

    return NextResponse.json(
      {
        success: true,
        generatedAt: read.scannedAt,
        lastRun: read.lastRun,
        scanBusy,
        clientsInScope: read.clientsInScope,
        clientsScanned: read.clientsScanned,
        notScanned: read.notScanned,
        notIndicatedOnly: read.notIndicatedOnly,
        sensitiveHidden: read.sensitiveHidden,
        truncated: stored?.scan.truncated ?? false,
        rows,
        conversion: conversion(rows),
        viewerId: gate.userId,
        clinicians: [...clinicians].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        locations: [...locations].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        config: { tmsMinTrials: TMS_DEFAULT_MIN_TRIALS, prpLocusMin: PRP_LOCUS_MIN },
      },
      { headers: { 'Cache-Control': 'no-store', 'Server-Timing': timing.header() } }
    );
  } catch (err: unknown) {
    console.error('[ehr/scanner/service-eligibility GET] error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load the service eligibility scan' }, { status: 500 });
  }
}
