import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canUseSudRadar } from '@/lib/clinical/sudRadar/access';
import { runSudRadarScan } from '@/lib/clinical/sudRadar/scan';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { practiceSudRadarAutoAssign } from '@/lib/practice/consumers';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Runs the SUD Referral Radar over the caller's organization — or, for caseload roles, only their
 * assigned clients — and returns counts only. Signals are read with GET /api/ehr/scanner/sud-radar,
 * which applies the 42 CFR Part 2 sensitive-record filter for the viewer.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseSudRadar(gate.role, gate.capabilities)) {
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'sudRadarScan',
      outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const caseload = isCaseloadScoped({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId });
  const started = Date.now();
  try {
    const autoAssignMeasures = await practiceSudRadarAutoAssign(gate.organizationId);
    // One scan at a time across all servers and the nightly cron (scripts/sud-radar-scan.ts):
    // same advisory lock key job:sud-radar-scan.
    const run = await withJobLock(JOB_LOCK_KEYS.sudRadarScan, () =>
      runSudRadarScan({
        organizationId: gate.organizationId,
        actor: { userId: gate.userId, role: gate.role },
        clientWhere: clientAccessWhere({
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role,
        }),
        trigger: 'manual',
        autoAssignMeasures,
      })
    );
    if (!run.acquired) {
      return NextResponse.json({ success: false, error: 'A scan is already running. Try again when it finishes.' }, { status: 409 });
    }
    const counts = run.result;
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'sudRadarScan', resourceId: 'run-ai-scan',
      metadata: {
        scope: caseload ? 'caseload' : 'organization',
        durationMs: Date.now() - started,
        clientsScanned: counts.clientsScanned,
        notesScanned: counts.notesScanned,
        documentsScanned: counts.documentsScanned,
        findings: counts.findings,
        bySource: counts.bySource,
        byConfidence: counts.byConfidence,
        byAction: counts.byAction,
        created: counts.created,
        updated: counts.updated,
        reopened: counts.reopened,
        resolved: counts.resolved,
        aiClientsReviewed: counts.ai.clientsReviewed,
        aiFailed: counts.ai.failed,
        aiSkippedConsent: counts.ai.skippedConsent,
        measuresAutoAssign: counts.measures.autoAssign,
        measuresAssigned: counts.measures.assigned,
      },
    });
    return NextResponse.json({
      success: true,
      scope: caseload ? 'caseload' : 'organization',
      durationMs: Date.now() - started,
      counts,
    });
  } catch (err: unknown) {
    console.error('[ehr/scanner/run-ai-scan] failed:', err instanceof Error ? err.message : 'unknown error');
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'sudRadarScan', resourceId: 'run-ai-scan',
      outcome: 'FAILURE', metadata: { reason: 'scan_error' },
    });
    return NextResponse.json(
      { success: false, error: 'The SUD Radar scan failed partway. Batches already saved are kept; run it again.' },
      { status: 500 }
    );
  }
}
