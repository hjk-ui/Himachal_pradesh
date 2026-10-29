import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { TIER_RULES } from '@/lib/insights/clinical/rules';
import { INSIGHTS_PATH, loadClientInsight } from '@/lib/insights/clinical/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/insights/clinical/[clientId] — live evaluation of one client for the drawer: signals
 * with values and dates, the tier rules that fired, trajectories, data gaps, a dated timeline and
 * rule-based suggestions. Scope + Part 2 lock are checked before any clinical row is read. Audited.
 */
export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, INSIGHTS_PATH, gate.capabilities)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { clientId } = await ctx.params;
  try {
    const r = await loadClientInsight({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId);
    if (r.ok === false) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clinicalInsightsClient', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: r.reason } });
      return NextResponse.json({ success: false, error: r.status === 404 ? 'Client not found' : 'Protected record', reason: r.reason }, { status: r.status });
    }
    const d = r.detail;
    const ev = d.evaluated.evaluation;
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'clinicalInsightsClient', resourceId: clientId, patientId: clientId,
      metadata: { tier: ev.tier, signals: ev.signals.length, rules: ev.rules.join(',') },
    });
    const f = d.evaluated.facts;
    return NextResponse.json(
      {
        success: true,
        evaluatedAt: d.evaluatedAt,
        today: d.today,
        row: d.row,
        tier: ev.tier,
        rules: TIER_RULES.filter((x) => ev.rules.includes(x.id)).map((x) => ({ id: x.id, tier: x.tier, text: x.text })),
        signals: ev.signals,
        trajectories: ev.trajectories,
        dataGaps: ev.dataGaps,
        timeline: d.timeline,
        suggestions: d.suggestions,
        summary: {
          lastVisit: f.lastVisit,
          nextAppointment: f.nextAppointment,
          safetyPlan: f.safetyPlan,
          plan: f.plan,
          cadence: f.cadence,
          portal: f.portal,
          programs: d.evaluated.programs,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[insights/clinical/client] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load this client' }, { status: 500 });
  }
}
