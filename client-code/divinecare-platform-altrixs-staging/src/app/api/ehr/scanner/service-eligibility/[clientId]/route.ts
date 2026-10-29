import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { loadClientDetail, scannerClient, SERVICE_SCANNER_PATH } from '@/lib/clinical/serviceEligibility/server';
import { decisionState } from '@/lib/clinical/serviceEligibility/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ehr/scanner/service-eligibility/[clientId] — evidence panel for one client: every
 * program evaluated live now (criteria met / not met / missing / confirm, dated evidence, data
 * gaps), decisions, payer fit and fee-schedule estimate. Scope: the viewer's org / caseload and
 * the 42 CFR Part 2 lock; denied reads are audited. Raw chart facts never leave the server.
 * ?summary=1 — stored snapshot statuses + decisions only (pre-visit brief chip; no live evaluation).
 */
export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { clientId } = await ctx.params;
  if (!canAccessPath(gate.role, SERVICE_SCANNER_PATH, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    if (new URL(req.url).searchParams.get('summary') === '1') {
      const access = await scannerClient({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId);
      if (access.ok === false) {
        await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'serviceEligibilityDetail', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason, summary: true } });
        return NextResponse.json({ success: false, error: 'Not available', reason: access.reason }, { status: access.status });
      }
      const [snap, decisions] = await Promise.all([
        prisma.serviceEligibilitySnapshot.findUnique({
          where: { organizationId_clientId: { organizationId: gate.organizationId, clientId } },
          select: { statuses: true, summary: true, scannedAt: true },
        }),
        prisma.serviceEligibilityDecision.findMany({
          where: { organizationId: gate.organizationId, clientId },
          select: { clientId: true, program: true, action: true, reason: true, reasonNote: true, snoozeUntil: true, outcome: true, decidedAt: true, decidedById: true },
        }),
      ]);
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'serviceEligibilityDetail', resourceId: clientId, patientId: clientId, metadata: { summary: true, scanned: Boolean(snap) } });
      return NextResponse.json(
        {
          success: true,
          scannedAt: snap?.scannedAt.toISOString() ?? null,
          statuses: snap?.statuses ?? null,
          gaps: (snap?.summary as { gaps?: unknown } | undefined)?.gaps ?? {},
          decisions: Object.fromEntries(decisions.map((d) => [d.program, decisionState(d)])),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const r = await loadClientDetail({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId);
    if (r.ok === false) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'serviceEligibilityDetail', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: r.reason } });
      return NextResponse.json(
        { success: false, error: r.status === 404 ? 'Client not found' : 'Protected record — open the chart to request access', reason: r.reason },
        { status: r.status }
      );
    }
    const { client, decisions, payerFit, revenue, evaluatedAt } = r.detail;
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'serviceEligibilityDetail', resourceId: clientId, patientId: clientId,
      metadata: { statuses: JSON.stringify(Object.fromEntries(Object.entries(client.results).map(([p, x]) => [p, x.status]))) },
    });
    return NextResponse.json({ success: true, client, decisions, payerFit, revenue, evaluatedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[scanner/service-eligibility detail] failed for client', clientId, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not evaluate this client' }, { status: 500 });
  }
}
