import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { getPreVisitBrief } from '@/lib/ai/previsit/service';
import { prismaPreVisitDeps } from '@/lib/ai/previsit/prismaSource';
import { canRequestClientBriefing } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pre-visit brief for one client (decision support; the clinician verifies against the chart).
 * GET  — today's brief (cached per client + practice day); POST — rebuild ("Refresh").
 * Gates, consent, 42 CFR Part 2, grounding and audit (AI_ACCESS / READ) live in
 * src/lib/ai/previsit/service.ts; every access is audited with counts only (no chart text).
 */
async function handle(req: Request, ctx: { params: Promise<{ id: string }> }, refresh: boolean) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const { id } = await ctx.params;
  // Same role rule as the AI briefing route: licensed clinicians, prescribers, medical providers, leadership
  if (!canRequestClientBriefing(gate.role)) {
    await auditPhiAccess({ req, gate, action: 'READ', resourceType: 'preVisitBrief', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role' } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Your role cannot view pre-visit briefs' }, { status: 403 });
  }
  const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
  try {
    const result = await getPreVisitBrief(
      prismaPreVisitDeps({ gate: viewer, req, path: `/api/clients/${id}/previsit-brief` }),
      viewer,
      id,
      { refresh }
    );
    if (result.ok === false) {
      return NextResponse.json({ success: false, error: result.error, reason: result.reason }, { status: result.status });
    }
    return NextResponse.json({ success: true, brief: result.brief }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    // ids and error class only — never chart content
    console.error('[clients/previsit-brief] failed for client', id, err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not build the pre-visit brief. Review the chart directly.' }, { status: 500 });
  }
}

export function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, ctx, false);
}

export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, ctx, true);
}
